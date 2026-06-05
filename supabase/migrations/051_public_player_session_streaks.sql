create or replace function public.public_player_session_streaks(p_season_id uuid default null)
returns table(
  streak_type text,
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
    group by str.session_id, str.team_id
  ),
  ranked_teams as (
    select
      sts.*,
      rank() over (
        partition by sts.session_id
        order by sts.points desc, sts.goal_difference desc, sts.goals_for desc, sts.away_goals desc
      ) winner_rank,
      rank() over (
        partition by sts.session_id
        order by sts.points asc, sts.goal_difference asc, sts.goals_for asc, sts.away_goals asc
      ) loser_rank
    from session_team_standings sts
  ),
  session_outcomes as (
    select
      rt.session_id,
      rt.team_id,
      'winning'::text streak_type
    from ranked_teams rt
    where rt.winner_rank = 1
      and rt.loser_rank > 1
    union all
    select
      rt.session_id,
      rt.team_id,
      'losing'::text streak_type
    from ranked_teams rt
    where rt.loser_rank = 1
      and rt.winner_rank > 1
  ),
  player_sessions as (
    select
      p.id player_id,
      p.display_name player_name,
      ss.season_id,
      ss.season_name,
      ss.session_id,
      ss.session_date,
      ss.session_name,
      ss.session_order,
      so.streak_type
    from public.players p
    cross join scored_sessions ss
    left join public.session_team_players stp
      on stp.player_id = p.id
      and stp.session_id = ss.session_id
    left join session_outcomes so
      on so.session_id = ss.session_id
      and so.team_id = stp.session_team_id
    where p.status = 'active'
  ),
  typed_player_sessions as (
    select 'winning'::text target_type, ps.* from player_sessions ps
    union all
    select 'losing'::text target_type, ps.* from player_sessions ps
  ),
  streak_groups as (
    select
      tps.*,
      count(*) filter (where tps.streak_type is distinct from tps.target_type) over (
        partition by tps.target_type, tps.player_id, tps.season_id
        order by tps.session_order
      ) streak_group
    from typed_player_sessions tps
  ),
  streaks as (
    select
      sg.target_type streak_type,
      sg.player_id,
      sg.player_name,
      sg.season_id,
      sg.season_name,
      count(*)::integer streak_count,
      min(sg.session_date) start_session_date,
      max(sg.session_date) end_session_date,
      array_agg(sg.session_name order by sg.session_order) session_names
    from streak_groups sg
    where sg.streak_type = sg.target_type
    group by sg.target_type, sg.player_id, sg.player_name, sg.season_id, sg.season_name, sg.streak_group
    having count(*) >= 2
  )
  select
    streak_type,
    player_id,
    player_name,
    season_id,
    season_name,
    streak_count,
    start_session_date,
    end_session_date,
    session_names
  from streaks
  order by streak_type, streak_count desc, end_session_date desc, player_name;
$$;

grant execute on function public.public_player_session_streaks(uuid) to anon, authenticated, service_role;
