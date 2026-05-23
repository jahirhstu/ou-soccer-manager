alter table public.goals
  add column if not exists match_id uuid references public.session_matches(id) on delete set null;

create index if not exists goals_match_id_idx on public.goals(match_id);

create table if not exists public.session_team_lineups (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  session_team_id uuid not null references public.session_teams(id) on delete cascade,
  player_count integer not null check (player_count > 0),
  formation text,
  positions jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(session_team_id)
);

create index if not exists session_team_lineups_session_id_idx on public.session_team_lineups(session_id);
create index if not exists session_team_lineups_team_id_idx on public.session_team_lineups(session_team_id);

drop trigger if exists session_team_lineups_updated_at on public.session_team_lineups;
create trigger session_team_lineups_updated_at before update on public.session_team_lineups for each row execute function public.set_updated_at();

alter table public.session_team_lineups enable row level security;

drop policy if exists "session_team_lineups_select" on public.session_team_lineups;
drop policy if exists "session_team_lineups_admin_all" on public.session_team_lineups;
drop policy if exists "session_team_lineups_captain_write" on public.session_team_lineups;
drop policy if exists "session_team_lineups_captain_update" on public.session_team_lineups;
drop policy if exists "session_team_lineups_captain_delete" on public.session_team_lineups;
drop policy if exists "session_matches_captain_delete" on public.session_matches;

create policy "session_team_lineups_select" on public.session_team_lineups for select using (auth.uid() is not null);
create policy "session_team_lineups_admin_all" on public.session_team_lineups for all using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
create policy "session_team_lineups_captain_write" on public.session_team_lineups for insert with check (public.app_role() = 'captain');
create policy "session_team_lineups_captain_update" on public.session_team_lineups for update using (public.app_role() = 'captain') with check (public.app_role() = 'captain');
create policy "session_team_lineups_captain_delete" on public.session_team_lineups for delete using (public.app_role() = 'captain');
create policy "session_matches_captain_delete" on public.session_matches for delete using (public.app_role() = 'captain');

drop policy if exists "goals_captain_delete" on public.goals;
create policy "goals_captain_delete" on public.goals for delete using (public.app_role() = 'captain');

grant all on table public.session_team_lineups to authenticated, service_role;
