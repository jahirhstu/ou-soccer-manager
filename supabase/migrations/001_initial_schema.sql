create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.players (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  phone text,
  email text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  preferred_position text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  email text,
  role text not null default 'player' check (role in ('admin', 'captain', 'player')),
  player_id uuid references public.players(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.player_aliases (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  alias_name text not null,
  normalized_alias text not null unique,
  match_count integer not null default 1,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_used_at timestamptz default now()
);

create table public.playgrounds (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  address text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date,
  end_date date,
  total_planned_sessions integer,
  price_per_session numeric(10,2) not null default 0,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  playground_id uuid references public.playgrounds(id) on delete set null,
  name text,
  session_date date not null,
  location text,
  start_time time,
  end_time time,
  price_per_session numeric(10,2),
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  team_a_score integer,
  team_b_score integer,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  payment_date date not null default current_date,
  amount numeric(10,2) not null,
  sessions_covered numeric(6,2),
  payment_method text,
  reference_note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  status text not null check (status in ('confirmed', 'played', 'absent', 'dropped', 'replacement', 'waitlisted')),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(session_id, player_id)
);

create table public.dropouts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  original_player_id uuid not null references public.players(id),
  replacement_player_id uuid references public.players(id),
  transfer_type text not null default 'manual_adjustment' check (transfer_type in ('credit_to_original_player','replacement_owes_original_player','replacement_paid_admin','no_credit','manual_adjustment')),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  session_id uuid references public.sessions(id) on delete set null,
  type text not null check (type in ('payment_received','session_used','credit_added','credit_transferred_out','credit_transferred_in','refund_due','refund_paid','manual_adjustment')),
  amount numeric(10,2),
  sessions_count numeric(6,2),
  description text,
  related_player_id uuid references public.players(id),
  related_dropout_id uuid references public.dropouts(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

create table public.session_player_charges (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  amount numeric(10,2) not null default 0,
  sessions_count numeric(6,2) not null default 1,
  source text not null check (source in ('whatsapp_import', 'session_completed', 'manual')),
  ledger_entry_id uuid references public.ledger_entries(id) on delete set null,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  unique(session_id, player_id)
);

create table public.session_teams (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  name text not null,
  label text,
  captain_player_id uuid references public.players(id) on delete set null,
  score integer,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(session_id, name)
);

create table public.session_team_players (
  id uuid primary key default gen_random_uuid(),
  session_team_id uuid not null references public.session_teams(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  unique(session_id, player_id)
);

create table public.session_matches (
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

create table public.session_team_update_events (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  match_id uuid references public.session_matches(id) on delete set null,
  scorer_id uuid not null references public.players(id),
  assist_player_id uuid references public.players(id),
  session_team_id uuid references public.session_teams(id) on delete set null,
  team text check (team in ('A', 'B')),
  goal_count integer not null default 1,
  minute integer,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.session_team_lineups (
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

create table public.whatsapp_imports (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references public.seasons(id),
  session_id uuid references public.sessions(id),
  raw_text text not null,
  parsed_json jsonb not null,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'discarded')),
  confidence text check (confidence in ('low', 'medium', 'high')),
  created_by uuid references public.profiles(id),
  confirmed_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  confirmed_at timestamptz
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz default now()
);

create index profiles_role_idx on public.profiles(role);
create index profiles_player_id_idx on public.profiles(player_id);
create index player_aliases_player_id_idx on public.player_aliases(player_id);
create index player_aliases_normalized_alias_idx on public.player_aliases(normalized_alias);
create index playgrounds_name_idx on public.playgrounds(name);
create index seasons_status_idx on public.seasons(status);
create index sessions_season_id_idx on public.sessions(season_id);
create index sessions_playground_id_idx on public.sessions(playground_id);
create index sessions_session_date_idx on public.sessions(session_date);
create index sessions_name_idx on public.sessions(name);
create index payments_season_player_idx on public.payments(season_id, player_id);
create index attendance_session_id_idx on public.attendance(session_id);
create index attendance_player_id_idx on public.attendance(player_id);
create index dropouts_session_id_idx on public.dropouts(session_id);
create index ledger_entries_season_player_idx on public.ledger_entries(season_id, player_id);
create index session_player_charges_session_id_idx on public.session_player_charges(session_id);
create index session_player_charges_player_id_idx on public.session_player_charges(player_id);
create index session_teams_session_id_idx on public.session_teams(session_id);
create index session_teams_captain_player_id_idx on public.session_teams(captain_player_id);
create index session_team_players_session_id_idx on public.session_team_players(session_id);
create index session_team_players_team_id_idx on public.session_team_players(session_team_id);
create index session_team_players_player_id_idx on public.session_team_players(player_id);
create index session_matches_session_id_idx on public.session_matches(session_id);
create index session_matches_team_a_id_idx on public.session_matches(team_a_id);
create index session_matches_team_b_id_idx on public.session_matches(team_b_id);
create index session_team_update_events_updated_at_idx on public.session_team_update_events(updated_at);
create index goals_session_id_idx on public.goals(session_id);
create index goals_scorer_id_idx on public.goals(scorer_id);
create index goals_assist_player_id_idx on public.goals(assist_player_id);
create index goals_session_team_id_idx on public.goals(session_team_id);
create index goals_match_id_idx on public.goals(match_id);
create index session_team_lineups_session_id_idx on public.session_team_lineups(session_id);
create index session_team_lineups_team_id_idx on public.session_team_lineups(session_team_id);
create index whatsapp_imports_status_idx on public.whatsapp_imports(status);

create trigger players_updated_at before update on public.players for each row execute function public.set_updated_at();
create trigger player_aliases_updated_at before update on public.player_aliases for each row execute function public.set_updated_at();
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger playgrounds_updated_at before update on public.playgrounds for each row execute function public.set_updated_at();
create trigger seasons_updated_at before update on public.seasons for each row execute function public.set_updated_at();
create trigger sessions_updated_at before update on public.sessions for each row execute function public.set_updated_at();
create trigger session_teams_updated_at before update on public.session_teams for each row execute function public.set_updated_at();
create trigger session_matches_updated_at before update on public.session_matches for each row execute function public.set_updated_at();
create trigger payments_updated_at before update on public.payments for each row execute function public.set_updated_at();
create trigger attendance_updated_at before update on public.attendance for each row execute function public.set_updated_at();
create trigger dropouts_updated_at before update on public.dropouts for each row execute function public.set_updated_at();
create trigger goals_updated_at before update on public.goals for each row execute function public.set_updated_at();
create trigger session_team_lineups_updated_at before update on public.session_team_lineups for each row execute function public.set_updated_at();

create or replace view public.player_season_payment_summary
with (security_invoker = true) as
with payment_totals as (
  select player_id, season_id, coalesce(sum(amount),0) total_paid_amount, coalesce(sum(sessions_covered),0) total_paid_sessions
  from public.payments group by player_id, season_id
),
played as (
  select
    a.player_id,
    s.season_id,
    count(*) filter (where a.status in ('played','replacement'))::numeric total_played_sessions,
    coalesce(sum(coalesce(s.price_per_session, seasons.price_per_session)) filter (where a.status in ('played','replacement')),0) estimated_used_amount
  from public.attendance a
  join public.sessions s on s.id = a.session_id
  join public.seasons seasons on seasons.id = s.season_id
  group by a.player_id, s.season_id
),
refunds as (
  select player_id, season_id, coalesce(sum(amount) filter (where type = 'refund_due'),0) refund_due_amount
  from public.ledger_entries group by player_id, season_id
)
select
  p.id player_id,
  p.display_name player_name,
  s.id season_id,
  s.name season_name,
  coalesce(pt.total_paid_amount,0) total_paid_amount,
  coalesce(pt.total_paid_sessions,0) total_paid_sessions,
  coalesce(pl.total_played_sessions,0) total_played_sessions,
  greatest(coalesce(pt.total_paid_sessions,0) - coalesce(pl.total_played_sessions,0), 0) remaining_sessions,
  coalesce(pl.estimated_used_amount,0) estimated_used_amount,
  greatest(coalesce(pt.total_paid_amount,0) - coalesce(pl.estimated_used_amount,0), 0) credit_amount,
  coalesce(r.refund_due_amount,0) refund_due_amount,
  greatest(coalesce(pl.estimated_used_amount,0) - coalesce(pt.total_paid_amount,0), 0) owes_money
from public.players p
cross join public.seasons s
left join payment_totals pt on pt.player_id = p.id and pt.season_id = s.id
left join played pl on pl.player_id = p.id and pl.season_id = s.id
left join refunds r on r.player_id = p.id and r.season_id = s.id;

create or replace view public.player_season_stats_summary
with (security_invoker = true) as
select
  p.id player_id,
  p.display_name player_name,
  s.id season_id,
  s.name season_name,
  count(distinct a.session_id) filter (where a.status in ('played','replacement'))::integer appearances,
  coalesce(sum(g.goal_count),0)::integer goals,
  count(ga.id)::integer assists
from public.players p
cross join public.seasons s
left join public.sessions ss on ss.season_id = s.id
left join public.attendance a on a.player_id = p.id and a.session_id = ss.id
left join public.goals g on g.scorer_id = p.id and g.session_id = ss.id
left join public.goals ga on ga.assist_player_id = p.id and ga.session_id = ss.id
group by p.id, p.display_name, s.id, s.name;

create or replace view public.player_playground_stats_summary
with (security_invoker = true) as
with playground_metrics as (
  select
    a.player_id,
    ss.playground_id,
    coalesce(pg.name, ss.location, 'Unknown playground') playground_name,
    0::integer goals,
    0::integer assists,
    count(distinct a.session_id) filter (where a.status in ('played','replacement'))::integer appearances
  from public.attendance a
  join public.sessions ss on ss.id = a.session_id
  left join public.playgrounds pg on pg.id = ss.playground_id
  group by a.player_id, ss.playground_id, coalesce(pg.name, ss.location, 'Unknown playground')
  union all
  select
    g.scorer_id player_id,
    ss.playground_id,
    coalesce(pg.name, ss.location, 'Unknown playground') playground_name,
    coalesce(sum(g.goal_count),0)::integer goals,
    0::integer assists,
    0::integer appearances
  from public.goals g
  join public.sessions ss on ss.id = g.session_id
  left join public.playgrounds pg on pg.id = ss.playground_id
  group by g.scorer_id, ss.playground_id, coalesce(pg.name, ss.location, 'Unknown playground')
  union all
  select
    g.assist_player_id player_id,
    ss.playground_id,
    coalesce(pg.name, ss.location, 'Unknown playground') playground_name,
    0::integer goals,
    count(g.id)::integer assists,
    0::integer appearances
  from public.goals g
  join public.sessions ss on ss.id = g.session_id
  left join public.playgrounds pg on pg.id = ss.playground_id
  where g.assist_player_id is not null
  group by g.assist_player_id, ss.playground_id, coalesce(pg.name, ss.location, 'Unknown playground')
),
summarized as (
  select
    player_id,
    playground_id,
    playground_name,
    sum(goals)::integer goals,
    sum(assists)::integer assists,
    sum(appearances)::integer appearances
  from playground_metrics
  group by player_id, playground_id, playground_name
)
select
  p.id player_id,
  p.display_name player_name,
  s.playground_id,
  s.playground_name,
  s.goals,
  s.assists,
  s.appearances,
  case when s.appearances > 0 then round(s.goals::numeric / s.appearances, 2) else 0 end goals_per_appearance
from summarized s
join public.players p on p.id = s.player_id;

create or replace function public.attendance_report()
returns table(player_id uuid, player_name text, sessions_played bigint, sessions_missed bigint, dropped_sessions bigint, replacement_sessions bigint)
language sql security definer set search_path = public as $$
  select p.id, p.display_name,
    count(a.id) filter (where a.status = 'played'),
    count(a.id) filter (where a.status = 'absent'),
    count(a.id) filter (where a.status = 'dropped'),
    count(a.id) filter (where a.status = 'replacement')
  from public.players p
  left join public.attendance a on a.player_id = p.id
  group by p.id, p.display_name
  order by p.display_name;
$$;

create or replace function public.public_player_report()
returns table(
  player_id uuid,
  player_name text,
  season_id uuid,
  season_name text,
  total_paid_amount numeric,
  total_played_sessions numeric,
  estimated_used_amount numeric,
  credit_amount numeric,
  owes_money numeric,
  balance_amount numeric,
  goals integer,
  assists integer,
  appearances integer,
  last_attended_sessions text[]
)
language sql stable security definer set search_path = public as $$
  with payment_totals as (
    select pay.player_id, pay.season_id, coalesce(sum(pay.amount),0) total_paid_amount
    from public.payments pay
    group by pay.player_id, pay.season_id
  ),
  played as (
    select
      a.player_id,
      s.season_id,
      count(*) filter (where a.status in ('played','replacement'))::numeric total_played_sessions,
      coalesce(sum(coalesce(s.price_per_session, seasons.price_per_session)) filter (where a.status in ('played','replacement')),0) estimated_used_amount
    from public.attendance a
    join public.sessions s on s.id = a.session_id
    join public.seasons seasons on seasons.id = s.season_id
    group by a.player_id, s.season_id
  ),
  scored as (
    select g.scorer_id as player_id, s.season_id, coalesce(sum(g.goal_count),0)::integer goals
    from public.goals g
    join public.sessions s on s.id = g.session_id
    group by g.scorer_id, s.season_id
  ),
  assisted as (
    select g.assist_player_id as player_id, s.season_id, count(g.id)::integer assists
    from public.goals g
    join public.sessions s on s.id = g.session_id
    where g.assist_player_id is not null
    group by g.assist_player_id, s.season_id
  ),
  last_sessions as (
    select
      ranked.player_id,
      ranked.season_id,
      array_agg(ranked.session_label order by ranked.session_date desc) last_attended_sessions
    from (
      select
        a.player_id,
        s.season_id,
        s.session_date,
        coalesce(nullif(s.name, ''), s.session_date::text) session_label,
        row_number() over (partition by a.player_id, s.season_id order by s.session_date desc, s.created_at desc) rn
      from public.attendance a
      join public.sessions s on s.id = a.session_id
      where a.status in ('played','replacement')
    ) ranked
    where ranked.rn <= 3
    group by ranked.player_id, ranked.season_id
  )
  select
    p.id player_id,
    p.display_name player_name,
    s.id season_id,
    s.name season_name,
    coalesce(pt.total_paid_amount,0) total_paid_amount,
    coalesce(pl.total_played_sessions,0) total_played_sessions,
    coalesce(pl.estimated_used_amount,0) estimated_used_amount,
    greatest(coalesce(pt.total_paid_amount,0) - coalesce(pl.estimated_used_amount,0), 0) credit_amount,
    greatest(coalesce(pl.estimated_used_amount,0) - coalesce(pt.total_paid_amount,0), 0) owes_money,
    coalesce(pt.total_paid_amount,0) - coalesce(pl.estimated_used_amount,0) balance_amount,
    coalesce(sc.goals,0) goals,
    coalesce(ast.assists,0) assists,
    coalesce(pl.total_played_sessions,0)::integer appearances,
    coalesce(ls.last_attended_sessions, array[]::text[]) last_attended_sessions
  from public.players p
  cross join public.seasons s
  left join payment_totals pt on pt.player_id = p.id and pt.season_id = s.id
  left join played pl on pl.player_id = p.id and pl.season_id = s.id
  left join scored sc on sc.player_id = p.id and sc.season_id = s.id
  left join assisted ast on ast.player_id = p.id and ast.season_id = s.id
  left join last_sessions ls on ls.player_id = p.id and ls.season_id = s.id
  where p.status = 'active'
    and (
      coalesce(pt.total_paid_amount,0) > 0
      or coalesce(pl.total_played_sessions,0) > 0
      or coalesce(sc.goals,0) > 0
      or coalesce(ast.assists,0) > 0
    )
  order by s.start_date desc nulls last, s.name, p.display_name;
$$;

create or replace function public.public_latest_session_winner(p_season_id uuid default null)
returns table(
  session_id uuid,
  session_name text,
  session_date date,
  winning_team_name text,
  winning_score integer,
  runner_up_score integer,
  is_draw boolean
)
language sql stable security definer set search_path = public as $$
  with latest_session as (
    select
      s.id,
      coalesce(nullif(s.name, ''), s.session_date::text) name,
      s.session_date
    from public.sessions s
    where (p_season_id is null or s.season_id = p_season_id)
      and exists (
        select 1
        from public.session_teams st
        where st.session_id = s.id
          and st.score is not null
      )
    order by s.session_date desc, s.created_at desc
    limit 1
  ),
  scored_teams as (
    select
      st.session_id,
      st.name,
      st.score
    from public.session_teams st
    join latest_session ls on ls.id = st.session_id
    where st.score is not null
  ),
  score_summary as (
    select
      max(score) top_score,
      (
        select max(score)
        from scored_teams
        where score < (select max(score) from scored_teams)
      ) runner_up_score
    from scored_teams
  ),
  winners as (
    select
      st.session_id,
      string_agg(st.name, ', ' order by st.name) names,
      count(*) winner_count
    from scored_teams st
    cross join score_summary ss
    where st.score = ss.top_score
    group by st.session_id
  )
  select
    ls.id session_id,
    ls.name session_name,
    ls.session_date,
    case when w.winner_count > 1 then 'Draw: ' || w.names else w.names end winning_team_name,
    ss.top_score winning_score,
    coalesce(ss.runner_up_score, ss.top_score) runner_up_score,
    w.winner_count > 1 is_draw
  from latest_session ls
  join winners w on w.session_id = ls.id
  cross join score_summary ss;
$$;

create or replace function public.public_leaderboards()
returns table (
  board text,
  name text,
  played integer,
  wins integer,
  draws integer,
  losses integer,
  goals_for integer,
  goals_against integer,
  goal_difference integer,
  points integer,
  points_per_game numeric,
  win_rate numeric
)
language sql
security definer
set search_path = public
as $$
  with sides as (
    select 'team'::text board, team_a.name::text name, sm.team_a_score::integer goals_for, sm.team_b_score::integer goals_against
    from public.session_matches sm
    join public.session_teams team_a on team_a.id = sm.team_a_id
    union all
    select 'team'::text board, team_b.name::text name, sm.team_b_score::integer goals_for, sm.team_a_score::integer goals_against
    from public.session_matches sm
    join public.session_teams team_b on team_b.id = sm.team_b_id
    union all
    select 'captain'::text board, captain_a.display_name::text name, sm.team_a_score::integer goals_for, sm.team_b_score::integer goals_against
    from public.session_matches sm
    join public.session_teams team_a on team_a.id = sm.team_a_id
    join public.players captain_a on captain_a.id = team_a.captain_player_id
    union all
    select 'captain'::text board, captain_b.display_name::text name, sm.team_b_score::integer goals_for, sm.team_a_score::integer goals_against
    from public.session_matches sm
    join public.session_teams team_b on team_b.id = sm.team_b_id
    join public.players captain_b on captain_b.id = team_b.captain_player_id
  ),
  grouped as (
    select
      board,
      name,
      count(*)::integer played,
      count(*) filter (where goals_for > goals_against)::integer wins,
      count(*) filter (where goals_for = goals_against)::integer draws,
      count(*) filter (where goals_for < goals_against)::integer losses,
      coalesce(sum(goals_for), 0)::integer goals_for,
      coalesce(sum(goals_against), 0)::integer goals_against,
      coalesce(sum(goals_for - goals_against), 0)::integer goal_difference,
      coalesce(sum(case when goals_for > goals_against then 3 when goals_for = goals_against then 1 else 0 end), 0)::integer points
    from sides
    where name is not null and length(trim(name)) > 0
    group by board, name
  )
  select
    board,
    name,
    played,
    wins,
    draws,
    losses,
    goals_for,
    goals_against,
    goal_difference,
    points,
    case when played > 0 then round(points::numeric / played, 2) else 0 end points_per_game,
    case when played > 0 then round((wins::numeric / played) * 100, 0) else 0 end win_rate
  from grouped
  order by board, points desc, goal_difference desc, goals_for desc, name;
$$;

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
          'score', st.score,
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

create or replace function public.app_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.current_player_id()
returns uuid language sql stable security definer set search_path = public as $$
  select player_id from public.profiles where id = auth.uid();
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, display_name, email, role)
  values(new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)), new.email, 'player')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.players enable row level security;
alter table public.player_aliases enable row level security;
alter table public.playgrounds enable row level security;
alter table public.seasons enable row level security;
alter table public.sessions enable row level security;
alter table public.payments enable row level security;
alter table public.attendance enable row level security;
alter table public.dropouts enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.session_player_charges enable row level security;
alter table public.session_teams enable row level security;
alter table public.session_team_players enable row level security;
alter table public.session_matches enable row level security;
alter table public.session_team_update_events enable row level security;
alter table public.goals enable row level security;
alter table public.session_team_lineups enable row level security;
alter table public.whatsapp_imports enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles_select" on public.profiles for select using (public.app_role() in ('admin','captain') or id = auth.uid());
create policy "profiles_self_insert" on public.profiles for insert with check (id = auth.uid());
create policy "profiles_admin_all" on public.profiles for all using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

create policy "players_select" on public.players for select using (public.app_role() in ('admin','captain') or id = public.current_player_id());
create policy "players_admin_all" on public.players for all using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

create policy "player_aliases_select" on public.player_aliases for select using (auth.uid() is not null);
create policy "player_aliases_admin_all" on public.player_aliases for all using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

create policy "playgrounds_select" on public.playgrounds for select using (auth.uid() is not null);
create policy "playgrounds_admin_all" on public.playgrounds for all using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

create policy "seasons_select" on public.seasons for select using (auth.uid() is not null);
create policy "seasons_admin_all" on public.seasons for all using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

create policy "sessions_select" on public.sessions for select using (auth.uid() is not null);
create policy "sessions_admin_all" on public.sessions for all using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

create policy "payments_select" on public.payments for select using (public.app_role() in ('admin','captain') or player_id = public.current_player_id());
create policy "payments_admin_all" on public.payments for all using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

create policy "attendance_select" on public.attendance for select using (public.app_role() in ('admin','captain') or player_id = public.current_player_id());
create policy "attendance_admin_all" on public.attendance for all using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
create policy "attendance_captain_write" on public.attendance for insert with check (public.app_role() = 'captain');
create policy "attendance_captain_update" on public.attendance for update using (public.app_role() = 'captain') with check (public.app_role() = 'captain');

create policy "dropouts_select" on public.dropouts for select using (public.app_role() in ('admin','captain') or original_player_id = public.current_player_id() or replacement_player_id = public.current_player_id());
create policy "dropouts_admin_all" on public.dropouts for all using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

create policy "ledger_select" on public.ledger_entries for select using (public.app_role() in ('admin','captain') or player_id = public.current_player_id());
create policy "ledger_admin_all" on public.ledger_entries for all using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

create policy "session_charges_select" on public.session_player_charges for select using (public.app_role() in ('admin','captain') or player_id = public.current_player_id());
create policy "session_charges_admin_all" on public.session_player_charges for all using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

create policy "session_teams_select" on public.session_teams for select using (auth.uid() is not null);
create policy "session_teams_admin_all" on public.session_teams for all using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
create policy "session_teams_captain_write" on public.session_teams for insert with check (public.app_role() = 'captain');
create policy "session_teams_captain_update" on public.session_teams for update using (public.app_role() = 'captain') with check (public.app_role() = 'captain');

create policy "session_team_players_select" on public.session_team_players for select using (auth.uid() is not null);
create policy "session_team_players_admin_all" on public.session_team_players for all using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
create policy "session_team_players_captain_write" on public.session_team_players for insert with check (public.app_role() = 'captain');
create policy "session_team_players_captain_update" on public.session_team_players for update using (public.app_role() = 'captain') with check (public.app_role() = 'captain');

create policy "session_matches_select" on public.session_matches for select using (auth.uid() is not null);
create policy "session_matches_admin_all" on public.session_matches for all using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
create policy "session_matches_captain_write" on public.session_matches for insert with check (public.app_role() = 'captain');
create policy "session_matches_captain_update" on public.session_matches for update using (public.app_role() = 'captain') with check (public.app_role() = 'captain');
create policy "session_matches_captain_delete" on public.session_matches for delete using (public.app_role() = 'captain');

create policy "session_team_update_events_public_select" on public.session_team_update_events for select using (true);

create policy "goals_select" on public.goals for select using (public.app_role() in ('admin','captain') or scorer_id = public.current_player_id() or assist_player_id = public.current_player_id());
create policy "goals_admin_all" on public.goals for all using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
create policy "goals_captain_write" on public.goals for insert with check (public.app_role() = 'captain');
create policy "goals_captain_update" on public.goals for update using (public.app_role() = 'captain') with check (public.app_role() = 'captain');
create policy "goals_captain_delete" on public.goals for delete using (public.app_role() = 'captain');

create policy "session_team_lineups_select" on public.session_team_lineups for select using (auth.uid() is not null);
create policy "session_team_lineups_admin_all" on public.session_team_lineups for all using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
create policy "session_team_lineups_captain_write" on public.session_team_lineups for insert with check (public.app_role() = 'captain');
create policy "session_team_lineups_captain_update" on public.session_team_lineups for update using (public.app_role() = 'captain') with check (public.app_role() = 'captain');
create policy "session_team_lineups_captain_delete" on public.session_team_lineups for delete using (public.app_role() = 'captain');

create policy "imports_admin_all" on public.whatsapp_imports for all using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
create policy "audit_admin_select" on public.audit_logs for select using (public.app_role() = 'admin');
create policy "audit_admin_insert" on public.audit_logs for insert with check (public.app_role() = 'admin');

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to authenticated, service_role;
grant select on table public.session_team_update_events to anon;
grant all on all routines in schema public to authenticated, service_role;
grant execute on function public.public_player_report() to anon, authenticated, service_role;
grant execute on function public.public_latest_session_winner(uuid) to anon, authenticated, service_role;
grant execute on function public.public_leaderboards() to anon, authenticated, service_role;
grant execute on function public.public_session_team_builder(uuid) to anon, authenticated, service_role;
grant execute on function public.save_session_team_builder(uuid, jsonb) to authenticated, service_role;
grant all on all sequences in schema public to authenticated, service_role;

alter default privileges in schema public grant all on tables to authenticated, service_role;
alter default privileges in schema public grant all on routines to authenticated, service_role;
alter default privileges in schema public grant all on sequences to authenticated, service_role;

alter table public.session_team_update_events replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.session_team_update_events;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
