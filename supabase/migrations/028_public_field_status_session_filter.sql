drop function if exists public.public_field_status();

create or replace function public.public_field_status(p_session_id uuid default null)
returns table(
  playground_name text,
  player_name text,
  goals integer,
  assists integer,
  appearances integer,
  goals_per_appearance numeric
)
language sql stable security definer set search_path = public as $$
  with scoped_sessions as (
    select
      sessions.id,
      coalesce(playgrounds.name, sessions.location, 'Unknown playground') playground_name
    from public.sessions
    left join public.playgrounds on playgrounds.id = sessions.playground_id
    where p_session_id is null or sessions.id = p_session_id
  ),
  session_sources as (
    select
      a.player_id,
      a.session_id
    from public.attendance a
    where a.status in ('played','replacement')
      and (p_session_id is null or a.session_id = p_session_id)
    union
    select
      stp.player_id,
      stp.session_id
    from public.session_team_players stp
    where p_session_id is null or stp.session_id = p_session_id
  ),
  metrics as (
    select
      ss.player_id,
      scoped_sessions.playground_name,
      0::integer goals,
      0::integer assists,
      count(distinct ss.session_id)::integer appearances
    from session_sources ss
    join scoped_sessions on scoped_sessions.id = ss.session_id
    group by ss.player_id, scoped_sessions.playground_name
    union all
    select
      g.scorer_id player_id,
      scoped_sessions.playground_name,
      coalesce(sum(g.goal_count), 0)::integer goals,
      0::integer assists,
      0::integer appearances
    from public.goals g
    join scoped_sessions on scoped_sessions.id = g.session_id
    where coalesce(g.goal_type, 'goal') = 'goal'
      and (p_session_id is null or g.session_id = p_session_id)
    group by g.scorer_id, scoped_sessions.playground_name
    union all
    select
      g.assist_player_id player_id,
      scoped_sessions.playground_name,
      0::integer goals,
      count(g.id)::integer assists,
      0::integer appearances
    from public.goals g
    join scoped_sessions on scoped_sessions.id = g.session_id
    where g.assist_player_id is not null
      and coalesce(g.goal_type, 'goal') = 'goal'
      and (p_session_id is null or g.session_id = p_session_id)
    group by g.assist_player_id, scoped_sessions.playground_name
  ),
  summarized as (
    select
      player_id,
      playground_name,
      sum(goals)::integer goals,
      sum(assists)::integer assists,
      sum(appearances)::integer appearances
    from metrics
    group by player_id, playground_name
  )
  select
    summarized.playground_name::text,
    players.display_name::text player_name,
    summarized.goals,
    summarized.assists,
    summarized.appearances,
    case when summarized.appearances > 0 then round(summarized.goals::numeric / summarized.appearances, 2) else 0 end goals_per_appearance
  from summarized
  join public.players on players.id = summarized.player_id
  where summarized.goals > 0
     or summarized.assists > 0
     or summarized.appearances > 0
  order by summarized.goals desc, summarized.assists desc, players.display_name;
$$;

grant execute on function public.public_field_status(uuid) to anon, authenticated, service_role;
