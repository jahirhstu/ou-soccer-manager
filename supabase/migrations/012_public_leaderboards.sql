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
    select
      'team'::text board,
      team_a.name::text name,
      sm.team_a_score::integer goals_for,
      sm.team_b_score::integer goals_against
    from public.session_matches sm
    join public.session_teams team_a on team_a.id = sm.team_a_id
    union all
    select
      'team'::text board,
      team_b.name::text name,
      sm.team_b_score::integer goals_for,
      sm.team_a_score::integer goals_against
    from public.session_matches sm
    join public.session_teams team_b on team_b.id = sm.team_b_id
    union all
    select
      'captain'::text board,
      captain_a.display_name::text name,
      sm.team_a_score::integer goals_for,
      sm.team_b_score::integer goals_against
    from public.session_matches sm
    join public.session_teams team_a on team_a.id = sm.team_a_id
    join public.players captain_a on captain_a.id = team_a.captain_player_id
    union all
    select
      'captain'::text board,
      captain_b.display_name::text name,
      sm.team_b_score::integer goals_for,
      sm.team_a_score::integer goals_against
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

grant execute on function public.public_leaderboards() to anon, authenticated, service_role;
