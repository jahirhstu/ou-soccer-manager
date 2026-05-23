create table if not exists public.session_matches (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  match_number integer not null,
  team_a_id uuid not null references public.session_teams(id) on delete cascade,
  team_b_id uuid not null references public.session_teams(id) on delete cascade,
  team_a_score integer not null default 0,
  team_b_score integer not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  check (match_number > 0),
  check (team_a_id <> team_b_id),
  unique(session_id, match_number)
);

create index if not exists session_matches_session_id_idx on public.session_matches(session_id);
create index if not exists session_matches_team_a_id_idx on public.session_matches(team_a_id);
create index if not exists session_matches_team_b_id_idx on public.session_matches(team_b_id);

drop trigger if exists session_matches_updated_at on public.session_matches;
create trigger session_matches_updated_at before update on public.session_matches for each row execute function public.set_updated_at();

alter table public.session_matches enable row level security;

drop policy if exists "session_matches_select" on public.session_matches;
drop policy if exists "session_matches_admin_all" on public.session_matches;
drop policy if exists "session_matches_captain_write" on public.session_matches;
drop policy if exists "session_matches_captain_update" on public.session_matches;

create policy "session_matches_select" on public.session_matches for select using (auth.uid() is not null);
create policy "session_matches_admin_all" on public.session_matches for all using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
create policy "session_matches_captain_write" on public.session_matches for insert with check (public.app_role() = 'captain');
create policy "session_matches_captain_update" on public.session_matches for update using (public.app_role() = 'captain') with check (public.app_role() = 'captain');

grant all on table public.session_matches to authenticated, service_role;
