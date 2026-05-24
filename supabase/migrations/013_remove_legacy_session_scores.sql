alter table public.sessions
  drop column if exists team_a_score,
  drop column if exists team_b_score;

alter table public.session_teams
  drop column if exists score;

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
        from public.session_matches sm
        where sm.session_id = s.id
      )
    order by s.session_date desc, s.created_at desc
    limit 1
  ),
  scored_teams as (
    select
      sm.session_id,
      sm.team_a_id team_id,
      st.name,
      sum(sm.team_a_score)::integer score
    from public.session_matches sm
    join public.session_teams st on st.id = sm.team_a_id
    join latest_session ls on ls.id = sm.session_id
    group by sm.session_id, sm.team_a_id, st.name
    union all
    select
      sm.session_id,
      sm.team_b_id team_id,
      st.name,
      sum(sm.team_b_score)::integer score
    from public.session_matches sm
    join public.session_teams st on st.id = sm.team_b_id
    join latest_session ls on ls.id = sm.session_id
    group by sm.session_id, sm.team_b_id, st.name
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
      scored.session_id,
      string_agg(scored.name, ', ' order by scored.name) names,
      count(*) winner_count
    from scored_teams scored
    cross join score_summary ss
    where scored.score = ss.top_score
    group by scored.session_id
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

grant execute on function public.public_latest_session_winner(uuid) to anon, authenticated, service_role;
grant execute on function public.public_session_team_builder(uuid) to anon, authenticated, service_role;
