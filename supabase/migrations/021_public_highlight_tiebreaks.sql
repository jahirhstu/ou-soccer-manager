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
language sql
stable
security definer
set search_path = public
as $$
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
    select session_id, team_id, team_name, captain_name, sum(goals)::integer goals
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
  player_appearances as (
    select
      a.player_id,
      count(distinct a.session_id) filter (where a.status in ('played','replacement'))::integer appearances
    from public.attendance a
    join public.sessions s on s.id = a.session_id
    where (p_season_id is null or s.season_id = p_season_id)
    group by a.player_id
  ),
  goal_totals as (
    select
      g.scorer_id player_id,
      sum(g.goal_count)::integer goals,
      coalesce(string_agg(distinct st.name, ', ' order by st.name) filter (where st.name is not null), 'No team') scorer_team_names
    from public.goals g
    join public.sessions s on s.id = g.session_id
    left join public.session_teams st on st.id = g.session_team_id
    where g.goal_type = 'goal'
      and (p_season_id is null or s.season_id = p_season_id)
    group by g.scorer_id
  ),
  assist_totals as (
    select
      g.assist_player_id player_id,
      count(g.id)::integer assists,
      coalesce(string_agg(distinct st.name, ', ' order by st.name) filter (where st.name is not null), 'No team') assist_team_names
    from public.goals g
    join public.sessions s on s.id = g.session_id
    left join public.session_teams st on st.id = g.session_team_id
    where g.goal_type = 'goal'
      and g.assist_player_id is not null
      and (p_season_id is null or s.season_id = p_season_id)
    group by g.assist_player_id
  ),
  player_stats as (
    select
      p.id player_id,
      p.display_name player_name,
      coalesce(gt.goals, 0)::integer goals,
      coalesce(at.assists, 0)::integer assists,
      coalesce(pa.appearances, 0)::integer appearances,
      case when coalesce(pa.appearances, 0) > 0 then coalesce(gt.goals, 0)::numeric / pa.appearances else 0 end goals_per_game,
      case when coalesce(pa.appearances, 0) > 0 then coalesce(at.assists, 0)::numeric / pa.appearances else 0 end assists_per_game,
      coalesce(gt.scorer_team_names, at.assist_team_names, 'No team') scorer_team_names,
      coalesce(at.assist_team_names, gt.scorer_team_names, 'No team') assist_team_names
    from public.players p
    left join goal_totals gt on gt.player_id = p.id
    left join assist_totals at on at.player_id = p.id
    left join player_appearances pa on pa.player_id = p.id
    where coalesce(gt.goals, 0) > 0
       or coalesce(at.assists, 0) > 0
       or coalesce(pa.appearances, 0) > 0
  ),
  scorer_ranked as (
    select
      *,
      dense_rank() over (order by goals desc, assists desc, goals_per_game desc) scorer_rank
    from player_stats
    where goals > 0
  ),
  top_scorer as (
    select
      'top_scorer'::text metric,
      string_agg(player_name, ', ' order by player_name) player_name,
      string_agg(scorer_team_names, ', ' order by player_name) team_name,
      case when count(*) > 1 then 'shared_rank' else null end captain_name,
      max(goals)::integer value,
      null::uuid session_id,
      null::text session_name,
      null::date session_date,
      case when count(*) > 1 then 'joint_top_scorer' else null end score
    from scorer_ranked
    where scorer_rank = 1
    group by goals, assists, goals_per_game
    limit 1
  ),
  assist_ranked as (
    select
      *,
      dense_rank() over (order by assists desc, goals desc, assists_per_game desc) assist_rank
    from player_stats
    where assists > 0
  ),
  top_assist as (
    select
      'top_assist'::text metric,
      string_agg(player_name, ', ' order by player_name) player_name,
      string_agg(assist_team_names, ', ' order by player_name) team_name,
      case when count(*) > 1 then 'shared_rank' else null end captain_name,
      max(assists)::integer value,
      null::uuid session_id,
      null::text session_name,
      null::date session_date,
      case when count(*) > 1 then 'joint_top_assister' else null end score
    from assist_ranked
    where assist_rank = 1
    group by assists, goals, assists_per_game
    limit 1
  )
  select * from latest_winner
  union all
  select * from top_scorer
  union all
  select * from top_assist;
$$;

grant execute on function public.public_dashboard_highlights(uuid) to anon, authenticated, service_role;
