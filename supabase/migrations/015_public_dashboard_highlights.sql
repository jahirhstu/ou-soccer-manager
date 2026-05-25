create or replace function public.public_dashboard_highlights(p_season_id uuid default null)
returns table(
  metric text,
  player_name text,
  team_name text,
  captain_name text,
  value integer,
  session_id uuid,
  session_name text,
  session_date date,
  score text
)
language sql stable security definer set search_path = public as $$
  with latest_session as (
    select
      s.id,
      coalesce(nullif(s.name, ''), s.session_date::text) name,
      s.session_date
    from public.sessions s
    where (p_season_id is null or s.season_id = p_season_id)
      and exists (select 1 from public.session_matches sm where sm.session_id = s.id)
    order by s.session_date desc, s.created_at desc
    limit 1
  ),
  scored_team_rows as (
    select sm.session_id, sm.team_a_id team_id, st.name team_name, captain.display_name captain_name, sum(sm.team_a_score)::integer goals
    from public.session_matches sm
    join public.session_teams st on st.id = sm.team_a_id
    left join public.players captain on captain.id = st.captain_player_id
    join latest_session ls on ls.id = sm.session_id
    group by sm.session_id, sm.team_a_id, st.name, captain.display_name
    union all
    select sm.session_id, sm.team_b_id team_id, st.name team_name, captain.display_name captain_name, sum(sm.team_b_score)::integer goals
    from public.session_matches sm
    join public.session_teams st on st.id = sm.team_b_id
    left join public.players captain on captain.id = st.captain_player_id
    join latest_session ls on ls.id = sm.session_id
    group by sm.session_id, sm.team_b_id, st.name, captain.display_name
  ),
  scored_teams as (
    select
      session_id,
      team_id,
      team_name,
      captain_name,
      sum(goals)::integer goals
    from scored_team_rows
    group by session_id, team_id, team_name, captain_name
  ),
  winner_summary as (
    select max(goals) winning_score, (
      select max(goals)
      from scored_teams
      where goals < (select max(goals) from scored_teams)
    ) runner_up_score
    from scored_teams
  ),
  latest_winner as (
    select
      'latest_winner'::text metric,
      null::text player_name,
      case when count(*) > 1 then 'Draw: ' || string_agg(st.team_name, ', ' order by st.team_name) else max(st.team_name) end team_name,
      string_agg(coalesce(st.captain_name, 'No captain'), ', ' order by st.team_name) captain_name,
      ws.winning_score value,
      ls.id session_id,
      ls.name session_name,
      ls.session_date,
      concat(ws.winning_score, '-', coalesce(ws.runner_up_score, ws.winning_score)) score
    from scored_teams st
    cross join winner_summary ws
    join latest_session ls on ls.id = st.session_id
    where st.goals = ws.winning_score
    group by ws.winning_score, ws.runner_up_score, ls.id, ls.name, ls.session_date
  ),
  top_scorer as (
    select
      'top_scorer'::text metric,
      p.display_name player_name,
      coalesce(st.name, 'No team') team_name,
      null::text captain_name,
      sum(g.goal_count)::integer value,
      null::uuid session_id,
      null::text session_name,
      null::date session_date,
      null::text score
    from public.goals g
    join public.players p on p.id = g.scorer_id
    join public.sessions s on s.id = g.session_id
    left join public.session_teams st on st.id = g.session_team_id
    where g.goal_type = 'goal'
      and (p_season_id is null or s.season_id = p_season_id)
    group by p.id, p.display_name, st.name
    order by sum(g.goal_count) desc, p.display_name
    limit 1
  ),
  top_assist as (
    select
      'top_assist'::text metric,
      p.display_name player_name,
      coalesce(st.name, 'No team') team_name,
      null::text captain_name,
      count(g.id)::integer value,
      null::uuid session_id,
      null::text session_name,
      null::date session_date,
      null::text score
    from public.goals g
    join public.players p on p.id = g.assist_player_id
    join public.sessions s on s.id = g.session_id
    left join public.session_teams st on st.id = g.session_team_id
    where g.goal_type = 'goal'
      and g.assist_player_id is not null
      and (p_season_id is null or s.season_id = p_season_id)
    group by p.id, p.display_name, st.name
    order by count(g.id) desc, p.display_name
    limit 1
  )
  select * from latest_winner
  union all
  select * from top_scorer
  union all
  select * from top_assist;
$$;

create or replace function public.public_field_status()
returns table(
  playground_name text,
  player_name text,
  goals integer,
  assists integer,
  appearances integer,
  goals_per_appearance numeric
)
language sql stable security definer set search_path = public as $$
  select
    playground_name::text,
    player_name::text,
    goals::integer,
    assists::integer,
    appearances::integer,
    goals_per_appearance::numeric
  from public.player_playground_stats_summary
  order by goals desc, assists desc, player_name;
$$;

grant execute on function public.public_dashboard_highlights(uuid) to anon, authenticated, service_role;
grant execute on function public.public_field_status() to anon, authenticated, service_role;
