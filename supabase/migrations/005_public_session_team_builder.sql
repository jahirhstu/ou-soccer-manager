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
  where ss.id = p_session_id;
$$;

create or replace function public.save_session_team_builder(p_session_id uuid, p_teams jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  team_item jsonb;
  player_id_text text;
  created_team_id uuid;
  actor_id uuid := auth.uid();
  team_name text;
begin
  if actor_id is null or public.app_role() not in ('admin', 'captain') then
    raise exception 'Unauthorized';
  end if;

  if not exists (select 1 from public.sessions where id = p_session_id) then
    raise exception 'Session not found';
  end if;

  delete from public.session_teams where session_id = p_session_id;

  for team_item in select value from jsonb_array_elements(coalesce(p_teams, '[]'::jsonb))
  loop
    team_name := nullif(trim(coalesce(team_item->>'name', '')), '');
    if team_name is null then
      continue;
    end if;

    insert into public.session_teams(session_id, name, label, captain_player_id, created_by)
    values (
      p_session_id,
      team_name,
      team_name,
      nullif(team_item->>'captainPlayerId', '')::uuid,
      actor_id
    )
    returning id into created_team_id;

    for player_id_text in select value from jsonb_array_elements_text(coalesce(team_item->'playerIds', '[]'::jsonb))
    loop
      insert into public.session_team_players(session_team_id, session_id, player_id, created_by)
      values (created_team_id, p_session_id, player_id_text::uuid, actor_id)
      on conflict (session_id, player_id) do nothing;
    end loop;
  end loop;

  insert into public.session_team_update_events(session_id, version, updated_at, updated_by)
  values (p_session_id, 1, now(), actor_id)
  on conflict (session_id) do update
  set
    version = public.session_team_update_events.version + 1,
    updated_at = now(),
    updated_by = excluded.updated_by;
end;
$$;

grant execute on function public.public_session_team_builder(uuid) to anon, authenticated, service_role;
grant execute on function public.save_session_team_builder(uuid, jsonb) to authenticated, service_role;
