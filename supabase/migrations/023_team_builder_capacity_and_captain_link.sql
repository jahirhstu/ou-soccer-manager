alter table public.session_team_update_events
  add column if not exists players_per_team integer;

create or replace function public.public_session_team_builder(p_session_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'session', jsonb_build_object(
      'id', ss.id,
      'name', ss.name,
      'sessionDate', ss.session_date,
      'location', coalesce(pg.name, ss.location),
      'status', ss.status,
      'seasonName', seasons.name
    ),
    'settings', jsonb_build_object(
      'playersPerTeam', ev.players_per_team
    ),
    'players', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.display_name,
          'status', a.status
        )
        order by p.display_name
      )
      from public.attendance a
      join public.players p on p.id = a.player_id
      where a.session_id = ss.id
        and a.status in ('confirmed','played','replacement','waitlisted')
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', st.id,
          'name', st.name,
          'captainPlayerId', st.captain_player_id,
          'players', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', p.id,
                'name', p.display_name
              )
              order by p.display_name
            )
            from public.session_team_players stp
            join public.players p on p.id = stp.player_id
            where stp.session_team_id = st.id
          ), '[]'::jsonb)
        )
        order by st.created_at, st.name
      )
      from public.session_teams st
      where st.session_id = ss.id
    ), '[]'::jsonb)
  )
  from public.sessions ss
  join public.seasons seasons on seasons.id = ss.season_id
  left join public.playgrounds pg on pg.id = ss.playground_id
  left join public.session_team_update_events ev on ev.session_id = ss.id
  where ss.id = p_session_id;
$$;

grant execute on function public.public_session_team_builder(uuid) to anon, authenticated, service_role;

create or replace function public.save_session_team_builder(p_session_id uuid, p_teams jsonb, p_players_per_team integer default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  team_item jsonb;
  player_id_text text;
  saved_team_id uuid;
  requested_team_id uuid;
  actor_id uuid := auth.uid();
  team_name text;
  kept_team_ids uuid[] := array[]::uuid[];
  normalized_players_per_team integer := greatest(1, coalesce(p_players_per_team, 8));
begin
  if actor_id is null or public.app_role() not in ('admin', 'captain') then
    raise exception 'Unauthorized';
  end if;

  if not exists (select 1 from public.sessions where id = p_session_id) then
    raise exception 'Session not found';
  end if;

  delete from public.session_team_players where session_id = p_session_id;

  for team_item in
    select value
    from jsonb_array_elements(
      case when jsonb_typeof(coalesce(p_teams, '[]'::jsonb)) = 'array' then coalesce(p_teams, '[]'::jsonb) else '[]'::jsonb end
    )
  loop
    team_name := nullif(trim(coalesce(team_item->>'name', '')), '');
    requested_team_id := null;
    saved_team_id := null;

    if team_name is null then
      continue;
    end if;

    if coalesce(team_item->>'id', '') ~* '^[0-9a-f-]{36}$' then
      requested_team_id := (team_item->>'id')::uuid;
    end if;

    if requested_team_id is not null and exists (
      select 1 from public.session_teams where id = requested_team_id and session_id = p_session_id
    ) then
      update public.session_teams
      set
        name = team_name,
        label = team_name,
        captain_player_id = nullif(team_item->>'captainPlayerId', '')::uuid
      where id = requested_team_id and session_id = p_session_id
      returning id into saved_team_id;
    else
      insert into public.session_teams(session_id, name, label, captain_player_id, created_by)
      values (
        p_session_id,
        team_name,
        team_name,
        nullif(team_item->>'captainPlayerId', '')::uuid,
        actor_id
      )
      returning id into saved_team_id;
    end if;

    kept_team_ids := array_append(kept_team_ids, saved_team_id);

    for player_id_text in
      select value
      from jsonb_array_elements_text(
        case when jsonb_typeof(team_item->'playerIds') = 'array' then team_item->'playerIds' else '[]'::jsonb end
      )
    loop
      if player_id_text ~* '^[0-9a-f-]{36}$' then
        insert into public.session_team_players(session_team_id, session_id, player_id, created_by)
        values (saved_team_id, p_session_id, player_id_text::uuid, actor_id)
        on conflict (session_id, player_id) do update
        set session_team_id = excluded.session_team_id;
      end if;
    end loop;
  end loop;

  delete from public.session_teams
  where session_id = p_session_id
    and not (id = any(kept_team_ids));

  insert into public.session_team_update_events(session_id, version, updated_at, updated_by, players_per_team)
  values (p_session_id, 1, now(), actor_id, normalized_players_per_team)
  on conflict (session_id) do update
  set
    version = public.session_team_update_events.version + 1,
    updated_at = now(),
    updated_by = excluded.updated_by,
    players_per_team = excluded.players_per_team;
end;
$$;

grant execute on function public.save_session_team_builder(uuid, jsonb, integer) to authenticated, service_role;

create or replace function public.link_current_captain_player_profile(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  current_role text;
  existing_player_id uuid;
begin
  if actor_id is null then
    raise exception 'Unauthorized';
  end if;

  select role, player_id
  into current_role, existing_player_id
  from public.profiles
  where id = actor_id;

  if current_role <> 'captain' then
    raise exception 'Only captain accounts can use this one-time link option';
  end if;

  if existing_player_id is not null then
    raise exception 'This captain account is already linked to a player profile';
  end if;

  if not exists (select 1 from public.players where id = p_player_id and status = 'active') then
    raise exception 'Selected player was not found';
  end if;

  if exists (select 1 from public.profiles where player_id = p_player_id and id <> actor_id) then
    raise exception 'Selected player is already linked to another account';
  end if;

  update public.profiles
  set player_id = p_player_id
  where id = actor_id
    and player_id is null;
end;
$$;

grant execute on function public.link_current_captain_player_profile(uuid) to authenticated, service_role;
