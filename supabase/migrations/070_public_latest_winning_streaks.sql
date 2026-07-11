create or replace function public.public_latest_winning_streaks(p_season_id uuid default null)
returns table(
  player_id uuid,
  player_name text,
  season_id uuid,
  season_name text,
  streak_count integer,
  start_session_date date,
  end_session_date date,
  session_names text[]
)
language sql
stable
security definer
set search_path = public
as $$
  with scored_sessions as (
    select
      s.id session_id,
      s.season_id,
      seasons.name season_name,
      s.session_date,
      s.created_at,
      coalesce(nullif(s.name, ''), s.session_date::text) session_name,
      row_number() over (partition by s.season_id order by s.session_date, s.created_at, s.id) session_order
    from public.sessions s
    join public.seasons on seasons.id = s.season_id
    where (p_season_id is null or s.season_id = p_season_id)
      and exists (
        select 1
        from public.session_matches sm
        where sm.session_id = s.id
          and sm.result_status = 'played'
      )
  ),
  latest_session as (
    select *
    from scored_sessions
    order by session_date desc, created_at desc, session_id desc
    limit 1
  ),
  scored_team_rows as (
    select
      sm.session_id,
      sm.team_a_id team_id,
      sm.team_a_score::integer goals_for,
      sm.team_b_score::integer goals_against,
      case when sm.away_team_id = sm.team_a_id then sm.team_a_score else 0 end::integer away_goals,
      case when sm.team_a_score > sm.team_b_score then 3 when sm.team_a_score = sm.team_b_score then 1 else 0 end::integer points
    from public.session_matches sm
    join scored_sessions ss on ss.session_id = sm.session_id
    where sm.result_status = 'played'
      and sm.team_a_id is not null
      and sm.team_b_id is not null
    union all
    select
      sm.session_id,
      sm.team_b_id team_id,
      sm.team_b_score::integer goals_for,
      sm.team_a_score::integer goals_against,
      case when sm.away_team_id = sm.team_b_id then sm.team_b_score else 0 end::integer away_goals,
      case when sm.team_b_score > sm.team_a_score then 3 when sm.team_b_score = sm.team_a_score then 1 else 0 end::integer points
    from public.session_matches sm
    join scored_sessions ss on ss.session_id = sm.session_id
    where sm.result_status = 'played'
      and sm.team_a_id is not null
      and sm.team_b_id is not null
  ),
  session_team_standings as (
    select
      str.session_id,
      str.team_id,
      sum(str.goals_for)::integer goals_for,
      sum(str.goals_against)::integer goals_against,
      (sum(str.goals_for) - sum(str.goals_against))::integer goal_difference,
      sum(str.away_goals)::integer away_goals,
      sum(str.points)::integer points
    from scored_team_rows str
    where str.team_id is not null
    group by str.session_id, str.team_id
  ),
  session_winners as (
    select session_id, team_id
    from (
      select
        sts.*,
        rank() over (
          partition by sts.session_id
          order by sts.points desc, sts.goal_difference desc, sts.goals_for desc, sts.away_goals desc
        ) winner_rank
      from session_team_standings sts
    ) ranked
    where winner_rank = 1
  ),
  latest_winner_players as (
    select distinct
      p.id player_id,
      p.display_name player_name,
      ls.season_id,
      ls.season_name,
      ls.session_order latest_session_order
    from latest_session ls
    join session_winners sw on sw.session_id = ls.session_id
    join public.session_team_players stp
      on stp.session_id = ls.session_id
      and stp.session_team_id = sw.team_id
    join public.players p on p.id = stp.player_id
  ),
  candidate_sessions as (
    select
      lwp.player_id,
      lwp.player_name,
      lwp.season_id,
      lwp.season_name,
      ss.session_id,
      ss.session_date,
      ss.session_name,
      ss.session_order,
      sw.team_id is not null is_winning_session
    from latest_winner_players lwp
    join scored_sessions ss
      on ss.season_id = lwp.season_id
      and ss.session_order <= lwp.latest_session_order
    left join public.session_team_players stp
      on stp.session_id = ss.session_id
      and stp.player_id = lwp.player_id
    left join session_winners sw
      on sw.session_id = ss.session_id
      and sw.team_id = stp.session_team_id
  ),
  reverse_groups as (
    select
      cs.*,
      count(*) filter (where not cs.is_winning_session) over (
        partition by cs.player_id, cs.season_id
        order by cs.session_order desc
      ) breaks_seen
    from candidate_sessions cs
  ),
  streaks as (
    select
      rg.player_id,
      rg.player_name,
      rg.season_id,
      rg.season_name,
      count(*)::integer streak_count,
      min(rg.session_date) start_session_date,
      max(rg.session_date) end_session_date,
      array_agg(rg.session_name order by rg.session_order) session_names
    from reverse_groups rg
    where rg.breaks_seen = 0
      and rg.is_winning_session
    group by rg.player_id, rg.player_name, rg.season_id, rg.season_name
  ),
  ranked_streaks as (
    select
      streaks.*,
      max(streak_count) over () max_streak_count
    from streaks
  )
  select
    player_id,
    player_name,
    season_id,
    season_name,
    streak_count,
    start_session_date,
    end_session_date,
    session_names
  from ranked_streaks
  where streak_count = max_streak_count
  order by player_name;
$$;

grant execute on function public.public_latest_winning_streaks(uuid) to anon, authenticated, service_role;
