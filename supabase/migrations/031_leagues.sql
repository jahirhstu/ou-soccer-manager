create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade default public.current_organization_id(),
  season_id uuid references public.seasons(id) on delete set null,
  name text not null,
  slug text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'completed', 'archived')),
  points_for_win integer not null default 3,
  points_for_draw integer not null default 1,
  points_for_loss integer not null default 0,
  start_date date,
  end_date date,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(organization_id, slug)
);

create table public.league_teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade default public.current_organization_id(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  name text not null,
  captain_player_id uuid references public.players(id) on delete set null,
  seed_order integer,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(league_id, name)
);

create table public.league_team_players (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade default public.current_organization_id(),
  league_team_id uuid not null references public.league_teams(id) on delete cascade,
  league_id uuid not null references public.leagues(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  unique(league_id, player_id)
);

create table public.league_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade default public.current_organization_id(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  session_id uuid references public.sessions(id) on delete set null,
  round_number integer not null,
  match_number integer not null,
  team_a_id uuid not null references public.league_teams(id) on delete cascade,
  team_b_id uuid not null references public.league_teams(id) on delete cascade,
  team_a_score integer,
  team_b_score integer,
  scheduled_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  check (round_number > 0),
  check (match_number > 0),
  check (team_a_id <> team_b_id),
  unique(league_id, match_number)
);

alter table public.goals add column if not exists league_match_id uuid references public.league_matches(id) on delete set null;

create index leagues_organization_id_idx on public.leagues(organization_id);
create index leagues_status_idx on public.leagues(status);
create index league_teams_league_id_idx on public.league_teams(league_id);
create index league_team_players_team_id_idx on public.league_team_players(league_team_id);
create index league_team_players_player_id_idx on public.league_team_players(player_id);
create index league_matches_league_id_idx on public.league_matches(league_id);
create index league_matches_session_id_idx on public.league_matches(session_id);
create index league_matches_team_a_id_idx on public.league_matches(team_a_id);
create index league_matches_team_b_id_idx on public.league_matches(team_b_id);
create index goals_league_match_id_idx on public.goals(league_match_id);

create trigger leagues_updated_at before update on public.leagues for each row execute function public.set_updated_at();
create trigger league_teams_updated_at before update on public.league_teams for each row execute function public.set_updated_at();
create trigger league_matches_updated_at before update on public.league_matches for each row execute function public.set_updated_at();

create or replace function public.league_standings(p_league_id uuid)
returns table(
  team_id uuid,
  team_name text,
  played integer,
  wins integer,
  draws integer,
  losses integer,
  goals_for integer,
  goals_against integer,
  goal_difference integer,
  points integer,
  rank integer
) language sql stable security invoker as $$
  with league_rules as (
    select points_for_win, points_for_draw, points_for_loss
    from public.leagues
    where id = p_league_id
  ),
  team_rows as (
    select id team_id, name team_name
    from public.league_teams
    where league_id = p_league_id
  ),
  match_rows as (
    select
      team_a_id team_id,
      team_a_score goals_for,
      team_b_score goals_against
    from public.league_matches
    where league_id = p_league_id
      and status = 'completed'
      and team_a_score is not null
      and team_b_score is not null
    union all
    select
      team_b_id team_id,
      team_b_score goals_for,
      team_a_score goals_against
    from public.league_matches
    where league_id = p_league_id
      and status = 'completed'
      and team_a_score is not null
      and team_b_score is not null
  ),
  scored as (
    select
      tr.team_id,
      tr.team_name,
      count(mr.team_id)::integer played,
      count(*) filter (where mr.goals_for > mr.goals_against)::integer wins,
      count(*) filter (where mr.goals_for = mr.goals_against)::integer draws,
      count(*) filter (where mr.goals_for < mr.goals_against)::integer losses,
      coalesce(sum(mr.goals_for), 0)::integer goals_for,
      coalesce(sum(mr.goals_against), 0)::integer goals_against
    from team_rows tr
    left join match_rows mr on mr.team_id = tr.team_id
    group by tr.team_id, tr.team_name
  )
  select
    scored.team_id,
    scored.team_name,
    scored.played,
    scored.wins,
    scored.draws,
    scored.losses,
    scored.goals_for,
    scored.goals_against,
    (scored.goals_for - scored.goals_against)::integer goal_difference,
    (scored.wins * lr.points_for_win + scored.draws * lr.points_for_draw + scored.losses * lr.points_for_loss)::integer points,
    row_number() over (
      order by
        (scored.wins * lr.points_for_win + scored.draws * lr.points_for_draw + scored.losses * lr.points_for_loss) desc,
        (scored.goals_for - scored.goals_against) desc,
        scored.goals_for desc,
        scored.team_name asc
    )::integer rank
  from scored
  cross join league_rules lr
  order by rank;
$$;

grant execute on function public.league_standings(uuid) to authenticated, service_role;

alter table public.leagues enable row level security;
alter table public.league_teams enable row level security;
alter table public.league_team_players enable row level security;
alter table public.league_matches enable row level security;

create policy "leagues_select" on public.leagues for select using (public.is_organization_member(organization_id));
create policy "leagues_admin_all" on public.leagues for all using (public.organization_role(organization_id) = 'admin') with check (public.organization_role(organization_id) = 'admin');

create policy "league_teams_select" on public.league_teams for select using (public.is_organization_member(organization_id));
create policy "league_teams_admin_all" on public.league_teams for all using (public.organization_role(organization_id) = 'admin') with check (public.organization_role(organization_id) = 'admin');
create policy "league_teams_captain_update" on public.league_teams for update using (public.organization_role(organization_id) = 'captain' and captain_player_id = public.current_player_id()) with check (public.organization_role(organization_id) = 'captain' and captain_player_id = public.current_player_id());

create policy "league_team_players_select" on public.league_team_players for select using (public.is_organization_member(organization_id));
create policy "league_team_players_admin_all" on public.league_team_players for all using (public.organization_role(organization_id) = 'admin') with check (public.organization_role(organization_id) = 'admin');

create policy "league_matches_select" on public.league_matches for select using (public.is_organization_member(organization_id));
create policy "league_matches_admin_all" on public.league_matches for all using (public.organization_role(organization_id) = 'admin') with check (public.organization_role(organization_id) = 'admin');
create policy "league_matches_captain_update" on public.league_matches for update using (public.organization_role(organization_id) = 'captain') with check (public.organization_role(organization_id) = 'captain');
