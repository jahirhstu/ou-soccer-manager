create table if not exists public.session_team_update_events (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

create index if not exists session_team_update_events_updated_at_idx on public.session_team_update_events(updated_at);

alter table public.session_team_update_events enable row level security;

drop policy if exists "session_team_update_events_public_select" on public.session_team_update_events;
create policy "session_team_update_events_public_select" on public.session_team_update_events for select using (true);

grant select on table public.session_team_update_events to anon;
grant all on table public.session_team_update_events to authenticated, service_role;

alter table public.session_team_update_events replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.session_team_update_events;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

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

grant execute on function public.save_session_team_builder(uuid, jsonb) to authenticated, service_role;
