drop function if exists public.public_goals_assists();

create or replace function public.public_goals_assists()
returns table(
  player_name text,
  season_id uuid,
  season_name text,
  goals integer,
  assists integer,
  sessions_count integer,
  games_count integer,
  goals_per_game numeric,
  assists_per_game numeric,
  goal_contributions_per_game numeric
)
language sql stable security definer set search_path = public as $$
  with session_sources as (
    select
      a.player_id,
      a.session_id
    from public.attendance a
    where a.status in ('played','replacement')
    union
    select
      stp.player_id,
      stp.session_id
    from public.session_team_players stp
  ),
  sessions_played as (
    select
      ss.player_id,
      s.season_id,
      count(distinct ss.session_id)::integer sessions_count
    from session_sources ss
    join public.sessions s on s.id = ss.session_id
    group by ss.player_id, s.season_id
  ),
  games_played as (
    select
      stp.player_id,
      s.season_id,
      count(distinct sm.id)::integer games_count
    from public.session_team_players stp
    join public.sessions s on s.id = stp.session_id
    join public.session_matches sm
      on sm.session_id = stp.session_id
     and (sm.team_a_id = stp.session_team_id or sm.team_b_id = stp.session_team_id)
    group by stp.player_id, s.season_id
  ),
  scored as (
    select
      g.scorer_id player_id,
      s.season_id,
      coalesce(sum(g.goal_count), 0)::integer goals
    from public.goals g
    join public.sessions s on s.id = g.session_id
    where coalesce(g.goal_type, 'goal') = 'goal'
    group by g.scorer_id, s.season_id
  ),
  assisted as (
    select
      g.assist_player_id player_id,
      s.season_id,
      count(g.id)::integer assists
    from public.goals g
    join public.sessions s on s.id = g.session_id
    where g.assist_player_id is not null
      and coalesce(g.goal_type, 'goal') = 'goal'
    group by g.assist_player_id, s.season_id
  )
  select
    p.display_name::text player_name,
    season.id season_id,
    season.name::text season_name,
    coalesce(sc.goals, 0)::integer goals,
    coalesce(ast.assists, 0)::integer assists,
    coalesce(sp.sessions_count, 0)::integer sessions_count,
    coalesce(gp.games_count, 0)::integer games_count,
    case when coalesce(gp.games_count, 0) > 0 then round(coalesce(sc.goals, 0)::numeric / gp.games_count, 2) else 0 end goals_per_game,
    case when coalesce(gp.games_count, 0) > 0 then round(coalesce(ast.assists, 0)::numeric / gp.games_count, 2) else 0 end assists_per_game,
    case when coalesce(gp.games_count, 0) > 0 then round((coalesce(sc.goals, 0) + coalesce(ast.assists, 0))::numeric / gp.games_count, 2) else 0 end goal_contributions_per_game
  from public.players p
  cross join public.seasons season
  left join sessions_played sp on sp.player_id = p.id and sp.season_id = season.id
  left join games_played gp on gp.player_id = p.id and gp.season_id = season.id
  left join scored sc on sc.player_id = p.id and sc.season_id = season.id
  left join assisted ast on ast.player_id = p.id and ast.season_id = season.id
  where coalesce(sc.goals, 0) > 0
     or coalesce(ast.assists, 0) > 0
  order by goals desc, assists desc, goals_per_game desc, player_name, season_name;
$$;

grant execute on function public.public_goals_assists() to anon, authenticated, service_role;
