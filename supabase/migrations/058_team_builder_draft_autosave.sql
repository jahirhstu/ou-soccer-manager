create table if not exists public.session_team_builder_drafts (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  teams jsonb not null default '[]'::jsonb,
  players_per_team integer not null default 8,
  draft_mode text not null default 'lottery' check (draft_mode in ('lottery', 'balanced')),
  pick_cursor integer not null default 0,
  toss_order_keys jsonb,
  roulette_rotation numeric not null default 0,
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists session_team_builder_drafts_organization_id_idx
  on public.session_team_builder_drafts(organization_id);

create index if not exists session_team_builder_drafts_updated_at_idx
  on public.session_team_builder_drafts(updated_at);

alter table public.session_team_builder_drafts enable row level security;

drop policy if exists "session_team_builder_drafts_select" on public.session_team_builder_drafts;
create policy "session_team_builder_drafts_select" on public.session_team_builder_drafts
  for select using (public.is_organization_member(organization_id));

drop policy if exists "session_team_builder_drafts_admin_all" on public.session_team_builder_drafts;
create policy "session_team_builder_drafts_admin_all" on public.session_team_builder_drafts
  for all using (public.organization_role(organization_id) = 'admin')
  with check (public.organization_role(organization_id) = 'admin');

drop policy if exists "session_team_builder_drafts_captain_write" on public.session_team_builder_drafts;
create policy "session_team_builder_drafts_captain_write" on public.session_team_builder_drafts
  for insert with check (public.organization_role(organization_id) = 'captain');

drop policy if exists "session_team_builder_drafts_captain_update" on public.session_team_builder_drafts;
create policy "session_team_builder_drafts_captain_update" on public.session_team_builder_drafts
  for update using (public.organization_role(organization_id) = 'captain')
  with check (public.organization_role(organization_id) = 'captain');

drop policy if exists "session_team_builder_drafts_captain_delete" on public.session_team_builder_drafts;
create policy "session_team_builder_drafts_captain_delete" on public.session_team_builder_drafts
  for delete using (public.organization_role(organization_id) = 'captain');

grant select on table public.session_team_builder_drafts to authenticated;
grant all on table public.session_team_builder_drafts to service_role;

create or replace function public.save_session_team_builder_draft(
  p_session_id uuid,
  p_teams jsonb,
  p_players_per_team integer,
  p_draft_mode text,
  p_pick_cursor integer,
  p_toss_order_keys jsonb default null,
  p_roulette_rotation numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  session_org_id uuid;
  saved_updated_at timestamptz;
begin
  if actor_id is null then
    raise exception 'Unauthorized';
  end if;

  select organization_id into session_org_id
  from public.sessions
  where id = p_session_id;

  if session_org_id is null then
    raise exception 'Session not found';
  end if;

  if public.organization_role(session_org_id) not in ('admin', 'captain') then
    raise exception 'Unauthorized';
  end if;

  insert into public.session_team_builder_drafts(
    session_id,
    organization_id,
    teams,
    players_per_team,
    draft_mode,
    pick_cursor,
    toss_order_keys,
    roulette_rotation,
    updated_by,
    updated_at
  )
  values (
    p_session_id,
    session_org_id,
    case when jsonb_typeof(coalesce(p_teams, '[]'::jsonb)) = 'array' then coalesce(p_teams, '[]'::jsonb) else '[]'::jsonb end,
    greatest(1, coalesce(p_players_per_team, 8)),
    case when p_draft_mode in ('lottery', 'balanced') then p_draft_mode else 'lottery' end,
    greatest(0, coalesce(p_pick_cursor, 0)),
    case when jsonb_typeof(p_toss_order_keys) = 'array' then p_toss_order_keys else null end,
    coalesce(p_roulette_rotation, 0),
    actor_id,
    now()
  )
  on conflict (session_id) do update
  set
    organization_id = excluded.organization_id,
    teams = excluded.teams,
    players_per_team = excluded.players_per_team,
    draft_mode = excluded.draft_mode,
    pick_cursor = excluded.pick_cursor,
    toss_order_keys = excluded.toss_order_keys,
    roulette_rotation = excluded.roulette_rotation,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at
  returning updated_at into saved_updated_at;

  return jsonb_build_object('updatedAt', saved_updated_at);
end;
$$;

grant execute on function public.save_session_team_builder_draft(uuid, jsonb, integer, text, integer, jsonb, numeric) to authenticated, service_role;

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
    'draft', (
      select jsonb_build_object(
        'teams', draft.teams,
        'playersPerTeam', draft.players_per_team,
        'draftMode', draft.draft_mode,
        'pickCursor', draft.pick_cursor,
        'tossOrderKeys', draft.toss_order_keys,
        'rouletteRotation', draft.roulette_rotation,
        'updatedAt', draft.updated_at
      )
      from public.session_team_builder_drafts draft
      where draft.session_id = ss.id
        and draft.organization_id = ss.organization_id
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
        and a.organization_id = ss.organization_id
        and p.organization_id = ss.organization_id
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
              and stp.organization_id = ss.organization_id
              and p.organization_id = ss.organization_id
          ), '[]'::jsonb)
        )
        order by st.created_at, st.name
      )
      from public.session_teams st
      where st.session_id = ss.id
        and st.organization_id = ss.organization_id
    ), '[]'::jsonb)
  )
  from public.sessions ss
  join public.seasons seasons on seasons.id = ss.season_id and seasons.organization_id = ss.organization_id
  left join public.playgrounds pg on pg.id = ss.playground_id and pg.organization_id = ss.organization_id
  left join public.session_team_update_events ev on ev.session_id = ss.id and ev.organization_id = ss.organization_id
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
  session_org_id uuid;
  team_name text;
  captain_id uuid;
  kept_team_ids uuid[] := array[]::uuid[];
  normalized_players_per_team integer := greatest(1, coalesce(p_players_per_team, 8));
begin
  if actor_id is null then
    raise exception 'Unauthorized';
  end if;

  select organization_id into session_org_id
  from public.sessions
  where id = p_session_id;

  if session_org_id is null then
    raise exception 'Session not found';
  end if;

  if public.organization_role(session_org_id) not in ('admin', 'captain') then
    raise exception 'Unauthorized';
  end if;

  delete from public.session_team_players
  where session_id = p_session_id
    and organization_id = session_org_id;

  for team_item in
    select value
    from jsonb_array_elements(
      case when jsonb_typeof(coalesce(p_teams, '[]'::jsonb)) = 'array' then coalesce(p_teams, '[]'::jsonb) else '[]'::jsonb end
    )
  loop
    team_name := nullif(trim(coalesce(team_item->>'name', '')), '');
    requested_team_id := null;
    saved_team_id := null;
    captain_id := null;

    if team_name is null then
      continue;
    end if;

    if coalesce(team_item->>'id', '') ~* '^[0-9a-f-]{36}$' then
      requested_team_id := (team_item->>'id')::uuid;
    end if;

    if coalesce(team_item->>'captainPlayerId', '') ~* '^[0-9a-f-]{36}$' then
      captain_id := (team_item->>'captainPlayerId')::uuid;
    end if;

    if requested_team_id is not null and exists (
      select 1
      from public.session_teams
      where id = requested_team_id
        and session_id = p_session_id
        and organization_id = session_org_id
    ) then
      update public.session_teams
      set
        name = team_name,
        label = team_name,
        captain_player_id = captain_id
      where id = requested_team_id
        and session_id = p_session_id
        and organization_id = session_org_id
      returning id into saved_team_id;
    else
      insert into public.session_teams(organization_id, session_id, name, label, captain_player_id, created_by)
      values (
        session_org_id,
        p_session_id,
        team_name,
        team_name,
        captain_id,
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
        insert into public.session_team_players(organization_id, session_team_id, session_id, player_id, created_by)
        values (session_org_id, saved_team_id, p_session_id, player_id_text::uuid, actor_id)
        on conflict (session_id, player_id) do update
        set
          session_team_id = excluded.session_team_id,
          organization_id = excluded.organization_id,
          created_by = excluded.created_by;
      end if;
    end loop;
  end loop;

  delete from public.session_teams
  where session_id = p_session_id
    and organization_id = session_org_id
    and not (id = any(kept_team_ids));

  insert into public.session_team_update_events(organization_id, session_id, version, updated_at, updated_by, players_per_team)
  values (session_org_id, p_session_id, 1, now(), actor_id, normalized_players_per_team)
  on conflict (session_id) do update
  set
    organization_id = excluded.organization_id,
    version = public.session_team_update_events.version + 1,
    updated_at = now(),
    updated_by = excluded.updated_by,
    players_per_team = excluded.players_per_team;

  delete from public.session_team_builder_drafts
  where session_id = p_session_id
    and organization_id = session_org_id;
end;
$$;

grant execute on function public.save_session_team_builder(uuid, jsonb, integer) to authenticated, service_role;
