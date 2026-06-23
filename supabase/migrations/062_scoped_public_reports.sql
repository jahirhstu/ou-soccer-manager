create or replace function public.resolve_enabled_public_scope(p_organization_slug text, p_program_slug text default null)
returns table (organization_id uuid, program_id uuid)
language sql stable security definer set search_path = public as $$
  select org.id, program.id
  from public.organizations org
  left join public.programs program
    on program.organization_id = org.id
   and program.slug = public.normalize_slug(p_program_slug)
   and program.status = 'active'
  where org.slug = public.normalize_slug(p_organization_slug)
    and org.public_reports_enabled
    and (nullif(public.normalize_slug(p_program_slug), '') is null or program.id is not null)
    and (
      program.id is null or not exists (
        select 1 from public.program_modules module
        where module.program_id = program.id and module.module_key = 'public_reports' and not module.enabled
      )
    )
  limit 1;
$$;

create or replace function public.scoped_public_player_report(p_organization_slug text, p_program_slug text default null)
returns table(
  player_id uuid, player_name text, season_id uuid, season_name text,
  total_paid_amount numeric, total_played_sessions numeric, confirmed_sessions numeric,
  estimated_used_amount numeric, credit_amount numeric, owes_money numeric, balance_amount numeric,
  goals integer, assists integer, appearances integer, last_attended_sessions text[],
  latest_session text, upcoming_session text
)
language sql stable security definer set search_path = public as $$
  select report.player_id, report.player_name, report.season_id, report.season_name,
    case when settings.public_payments_enabled then report.total_paid_amount else null end,
    report.total_played_sessions, report.confirmed_sessions,
    case when settings.public_balances_enabled then report.estimated_used_amount else null end,
    case when settings.public_balances_enabled then report.credit_amount else null end,
    case when settings.public_balances_enabled then report.owes_money else null end,
    case when settings.public_balances_enabled then report.balance_amount else null end,
    report.goals, report.assists, report.appearances, report.last_attended_sessions,
    report.latest_session, report.upcoming_session
  from public.resolve_enabled_public_scope(p_organization_slug, p_program_slug) scope
  join public.organization_settings settings on settings.organization_id = scope.organization_id
  join public.seasons season
    on season.organization_id = scope.organization_id
   and (scope.program_id is null or season.program_id = scope.program_id)
  join public.public_player_report() report on report.season_id = season.id;
$$;

create or replace function public.scoped_public_modules(p_organization_slug text, p_program_slug text)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(module.module_key order by module.module_key) filter (where module.enabled), '{}'::text[])
  from public.resolve_enabled_public_scope(p_organization_slug, p_program_slug) scope
  left join public.program_modules module on module.program_id = scope.program_id;
$$;

create or replace function public.internal_scoped_player_report(p_organization_slug text, p_program_slug text default null)
returns table(
  player_id uuid, player_name text, season_id uuid, season_name text,
  total_paid_amount numeric, total_played_sessions numeric, confirmed_sessions numeric,
  estimated_used_amount numeric, credit_amount numeric, owes_money numeric, balance_amount numeric,
  goals integer, assists integer, appearances integer, last_attended_sessions text[],
  latest_session text, upcoming_session text
)
language sql stable security definer set search_path = public as $$
  select report.*
  from public.organizations organization
  join public.seasons season on season.organization_id = organization.id
  join public.public_player_report() report on report.season_id = season.id
  where organization.slug = public.normalize_slug(p_organization_slug)
    and public.is_organization_member(organization.id)
    and (
      nullif(public.normalize_slug(p_program_slug), '') is null
      or season.program_id in (
        select id from public.programs where organization_id = organization.id and slug = public.normalize_slug(p_program_slug)
      )
    );
$$;

create or replace function public.scoped_public_sessions(p_organization_slug text, p_program_slug text default null)
returns table (
  id uuid, name text, session_date date, season_name text, playground_name text,
  location text, price_per_session numeric, status text
)
language sql stable security definer set search_path = public as $$
  select sessions.id, sessions.name, sessions.session_date, seasons.name,
    playgrounds.name, sessions.location, sessions.price_per_session, sessions.status
  from public.resolve_enabled_public_scope(p_organization_slug, p_program_slug) scope
  join public.sessions sessions
    on sessions.organization_id = scope.organization_id
   and (scope.program_id is null or sessions.program_id = scope.program_id)
  join public.seasons seasons on seasons.id = sessions.season_id and seasons.organization_id = scope.organization_id
  left join public.playgrounds playgrounds on playgrounds.id = sessions.playground_id
  order by sessions.session_date desc, sessions.created_at desc;
$$;

create or replace function public.scoped_public_dashboard_highlights(
  p_organization_slug text,
  p_program_slug text default null,
  p_season_id uuid default null
)
returns table(
  metric text, player_name text, team_name text, captain_name text, value integer,
  session_id uuid, session_name text, session_date date, score text
)
language sql stable security definer set search_path = public as $$
  select highlights.*
  from public.resolve_enabled_public_scope(p_organization_slug, p_program_slug) scope
  cross join lateral (
    select seasons.id
    from public.seasons
    where seasons.organization_id = scope.organization_id
      and (scope.program_id is null or seasons.program_id = scope.program_id)
      and (p_season_id is null or seasons.id = p_season_id)
    order by (seasons.status = 'active') desc, seasons.created_at desc
    limit 1
  ) selected
  cross join lateral public.public_dashboard_highlights(selected.id) highlights;
$$;

create or replace function public.scoped_public_player_session_streaks(
  p_organization_slug text,
  p_program_slug text default null,
  p_season_id uuid default null
)
returns table(
  streak_type text, player_id uuid, player_name text, season_id uuid, season_name text,
  streak_count integer, start_session_date date, end_session_date date, session_names text[]
)
language sql stable security definer set search_path = public as $$
  select streaks.*
  from public.resolve_enabled_public_scope(p_organization_slug, p_program_slug) scope
  join public.seasons seasons
    on seasons.organization_id = scope.organization_id
   and (scope.program_id is null or seasons.program_id = scope.program_id)
   and (p_season_id is null or seasons.id = p_season_id)
  cross join lateral public.public_player_session_streaks(seasons.id) streaks;
$$;

create or replace function public.scoped_public_session_detail(
  p_organization_slug text, p_program_slug text, p_session_id uuid
)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.public_session_detail(p_session_id)
  from public.resolve_enabled_public_scope(p_organization_slug, p_program_slug) scope
  join public.sessions session on session.id = p_session_id
    and session.organization_id = scope.organization_id
    and (scope.program_id is null or session.program_id = scope.program_id);
$$;

create or replace function public.scoped_public_leaderboards(p_organization_slug text, p_program_slug text default null)
returns table (
  board text, name text, played integer, wins integer, draws integer, losses integer,
  goals_for integer, goals_against integer, goal_difference integer, away_goals integer,
  points integer, points_per_game numeric, win_rate numeric
)
language sql stable security definer set search_path = public as $$
  with scope as (
    select * from public.resolve_enabled_public_scope(p_organization_slug, p_program_slug)
  ),
  sides as (
    select 'team'::text board, team_a.name::text name, sm.team_a_score::integer goals_for,
      sm.team_b_score::integer goals_against,
      case when sm.away_team_id = sm.team_a_id then sm.team_a_score else 0 end::integer away_goals
    from scope join public.session_matches sm on sm.organization_id = scope.organization_id
      and (scope.program_id is null or sm.program_id = scope.program_id)
    join public.session_teams team_a on team_a.id = sm.team_a_id
    where sm.result_status = 'played'
    union all
    select 'team'::text, team_b.name::text, sm.team_b_score::integer, sm.team_a_score::integer,
      case when sm.away_team_id = sm.team_b_id then sm.team_b_score else 0 end::integer
    from scope join public.session_matches sm on sm.organization_id = scope.organization_id
      and (scope.program_id is null or sm.program_id = scope.program_id)
    join public.session_teams team_b on team_b.id = sm.team_b_id
    where sm.result_status = 'played'
    union all
    select 'captain'::text, captain_a.display_name::text, sm.team_a_score::integer, sm.team_b_score::integer,
      case when sm.away_team_id = sm.team_a_id then sm.team_a_score else 0 end::integer
    from scope join public.session_matches sm on sm.organization_id = scope.organization_id
      and (scope.program_id is null or sm.program_id = scope.program_id)
    join public.session_teams team_a on team_a.id = sm.team_a_id
    join public.players captain_a on captain_a.id = team_a.captain_player_id
    where sm.result_status = 'played'
    union all
    select 'captain'::text, captain_b.display_name::text, sm.team_b_score::integer, sm.team_a_score::integer,
      case when sm.away_team_id = sm.team_b_id then sm.team_b_score else 0 end::integer
    from scope join public.session_matches sm on sm.organization_id = scope.organization_id
      and (scope.program_id is null or sm.program_id = scope.program_id)
    join public.session_teams team_b on team_b.id = sm.team_b_id
    join public.players captain_b on captain_b.id = team_b.captain_player_id
    where sm.result_status = 'played'
  ),
  grouped as (
    select board, name, count(*)::integer played,
      count(*) filter (where goals_for > goals_against)::integer wins,
      count(*) filter (where goals_for = goals_against)::integer draws,
      count(*) filter (where goals_for < goals_against)::integer losses,
      coalesce(sum(goals_for), 0)::integer goals_for,
      coalesce(sum(goals_against), 0)::integer goals_against,
      coalesce(sum(goals_for - goals_against), 0)::integer goal_difference,
      coalesce(sum(away_goals), 0)::integer away_goals,
      coalesce(sum(case when goals_for > goals_against then 3 when goals_for = goals_against then 1 else 0 end), 0)::integer points
    from sides where name is not null and length(trim(name)) > 0 group by board, name
  )
  select board, name, played, wins, draws, losses, goals_for, goals_against, goal_difference,
    away_goals, points,
    case when played > 0 then round(points::numeric / played, 2) else 0 end,
    case when played > 0 then round((wins::numeric / played) * 100, 0) else 0 end
  from grouped order by board, points desc, goal_difference desc, goals_for desc, away_goals desc, name;
$$;

create or replace function public.scoped_public_goals_assists(
  p_organization_slug text, p_program_slug text default null, p_session_id uuid default null
)
returns table(
  player_name text, season_id uuid, season_name text, goals integer, assists integer,
  sessions_count integer, games_count integer, goals_per_game numeric,
  assists_per_game numeric, goal_contributions_per_game numeric
)
language sql stable security definer set search_path = public as $$
  with rows as (
    select report.*
    from public.resolve_enabled_public_scope(p_organization_slug, p_program_slug) scope
    join public.sessions session on session.organization_id = scope.organization_id
      and (scope.program_id is null or session.program_id = scope.program_id)
      and (p_session_id is null or session.id = p_session_id)
    cross join lateral public.public_goals_assists(session.id) report
  )
  select player_name, season_id, max(season_name), sum(goals)::integer, sum(assists)::integer,
    sum(sessions_count)::integer, sum(games_count)::integer,
    case when sum(games_count) > 0 then round(sum(goals)::numeric / sum(games_count), 2) else 0 end,
    case when sum(games_count) > 0 then round(sum(assists)::numeric / sum(games_count), 2) else 0 end,
    case when sum(games_count) > 0 then round((sum(goals) + sum(assists))::numeric / sum(games_count), 2) else 0 end
  from rows group by player_name, season_id;
$$;

create or replace function public.scoped_public_field_status(
  p_organization_slug text, p_program_slug text default null, p_session_id uuid default null
)
returns table(
  playground_name text, player_name text, goals integer, assists integer,
  appearances integer, goals_per_appearance numeric
)
language sql stable security definer set search_path = public as $$
  with rows as (
    select report.*
    from public.resolve_enabled_public_scope(p_organization_slug, p_program_slug) scope
    join public.sessions session on session.organization_id = scope.organization_id
      and (scope.program_id is null or session.program_id = scope.program_id)
      and (p_session_id is null or session.id = p_session_id)
    cross join lateral public.public_field_status(session.id) report
  )
  select playground_name, player_name, sum(goals)::integer, sum(assists)::integer,
    sum(appearances)::integer,
    case when sum(appearances) > 0 then round(sum(goals)::numeric / sum(appearances), 2) else 0 end
  from rows group by playground_name, player_name;
$$;

create or replace function public.scoped_public_game_score_editor(
  p_organization_slug text, p_program_slug text, p_session_id uuid
)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.public_game_score_editor(p_session_id)
  from public.resolve_enabled_public_scope(p_organization_slug, p_program_slug) scope
  join public.sessions session on session.id = p_session_id and session.organization_id = scope.organization_id
    and (scope.program_id is null or session.program_id = scope.program_id);
$$;

create or replace function public.scoped_public_session_team_builder(
  p_organization_slug text, p_program_slug text, p_session_id uuid
)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.public_session_team_builder(p_session_id)
  from public.resolve_enabled_public_scope(p_organization_slug, p_program_slug) scope
  join public.sessions session on session.id = p_session_id and session.organization_id = scope.organization_id
    and (scope.program_id is null or session.program_id = scope.program_id);
$$;

revoke all on function public.public_player_report() from public, anon, authenticated;
revoke all on function public.public_sessions() from public, anon, authenticated;
revoke all on function public.public_dashboard_highlights(uuid) from public, anon, authenticated;
revoke all on function public.public_player_session_streaks(uuid) from public, anon, authenticated;
revoke all on function public.public_session_detail(uuid) from public, anon, authenticated;
revoke all on function public.public_leaderboards() from public, anon, authenticated;
revoke all on function public.public_goals_assists(uuid) from public, anon, authenticated;
revoke all on function public.public_field_status(uuid) from public, anon, authenticated;
revoke all on function public.public_game_score_editor(uuid) from public, anon, authenticated;
revoke all on function public.public_session_team_builder(uuid) from public, anon, authenticated;
revoke all on function public.public_latest_session_winner(uuid) from public, anon, authenticated;
revoke all on function public.internal_scoped_player_report(text, text) from public, anon;

drop policy if exists "session_team_update_events_public_select" on public.session_team_update_events;
create policy "session_team_update_events_enabled_public_select" on public.session_team_update_events for select using (
  exists (
    select 1 from public.sessions session
    join public.organizations organization on organization.id = session.organization_id and organization.public_reports_enabled
    where session.id = session_team_update_events.session_id
      and not exists (
        select 1 from public.program_modules module
        where module.program_id = session.program_id and module.module_key = 'public_reports' and not module.enabled
      )
  )
);
create policy "session_team_update_events_member_select" on public.session_team_update_events for select using (
  public.is_organization_member(organization_id)
);

grant execute on function public.resolve_enabled_public_scope(text, text) to anon, authenticated;
grant execute on function public.scoped_public_player_report(text, text) to anon, authenticated;
grant execute on function public.scoped_public_modules(text, text) to anon, authenticated;
grant execute on function public.internal_scoped_player_report(text, text) to authenticated;
grant execute on function public.scoped_public_sessions(text, text) to anon, authenticated;
grant execute on function public.scoped_public_dashboard_highlights(text, text, uuid) to anon, authenticated;
grant execute on function public.scoped_public_player_session_streaks(text, text, uuid) to anon, authenticated;
grant execute on function public.scoped_public_session_detail(text, text, uuid) to anon, authenticated;
grant execute on function public.scoped_public_leaderboards(text, text) to anon, authenticated;
grant execute on function public.scoped_public_goals_assists(text, text, uuid) to anon, authenticated;
grant execute on function public.scoped_public_field_status(text, text, uuid) to anon, authenticated;
grant execute on function public.scoped_public_game_score_editor(text, text, uuid) to anon, authenticated;
grant execute on function public.scoped_public_session_team_builder(text, text, uuid) to anon, authenticated;
