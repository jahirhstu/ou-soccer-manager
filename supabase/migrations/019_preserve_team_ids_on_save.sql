create or replace function public.save_session_team_builder(p_session_id uuid, p_teams jsonb)
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

  insert into public.session_team_update_events(session_id, version, updated_at, updated_by)
  values (p_session_id, 1, now(), actor_id)
  on conflict (session_id) do update
  set
    version = public.session_team_update_events.version + 1,
    updated_at = now(),
    updated_by = excluded.updated_by;
end;
$$;

grant execute on function public.save_session_team_builder(uuid, jsonb) to authenticated, service_role;
