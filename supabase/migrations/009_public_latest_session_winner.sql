drop function if exists public.public_latest_session_winner(uuid);

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

grant execute on function public.public_latest_session_winner(uuid) to anon, authenticated, service_role;
