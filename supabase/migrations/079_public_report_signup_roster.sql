-- Confirmed signup rosters identify season members even before payment or attendance.
-- Use the reviewed player UUIDs saved by the importer, never a name match.
create or replace function public.public_player_report()
returns table(
  player_id uuid, player_name text, season_id uuid, season_name text,
  total_paid_amount numeric, total_played_sessions numeric,
  confirmed_sessions numeric, estimated_used_amount numeric,
  credit_amount numeric, owes_money numeric, balance_amount numeric,
  goals integer, assists integer, appearances integer,
  last_attended_sessions text[], latest_session text, upcoming_session text
)
language sql stable security definer set search_path = public as $$
  with signup_roster as (
    select distinct wi.season_id, wi.organization_id,
      imported_player ->> 'matchedPlayerId' player_id
    from public.whatsapp_imports wi
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(wi.parsed_json -> 'players') = 'array'
        then wi.parsed_json -> 'players' else '[]'::jsonb end
    ) imported_player
    where wi.status = 'confirmed'
      and wi.parsed_json ->> 'importType' = 'season_signup'
      and imported_player ->> 'matchedPlayerId' is not null
  ),
  attendance_usage as (
    select a.player_id, s.season_id,
      count(*) filter (
        where a.status in ('played', 'replacement')
          or (a.status = 'confirmed' and (s.status = 'completed' or s.session_date < (now() at time zone 'America/Toronto')::date))
      )::numeric total_played_sessions,
      count(*) filter (
        where a.status in ('confirmed', 'waitlisted')
          and s.status = 'scheduled'
          and s.session_date >= (now() at time zone 'America/Toronto')::date
      )::numeric confirmed_sessions,
      coalesce(sum(case
        when a.status in ('played', 'replacement')
          or (a.status = 'confirmed' and (s.status = 'completed' or s.session_date < (now() at time zone 'America/Toronto')::date))
          then coalesce(spc.amount, s.price_per_session, seasons.price_per_session)
        when a.status in ('confirmed', 'played', 'replacement') and spc.id is not null
          then spc.amount
        else 0 end), 0) estimated_used_amount
    from public.attendance a
    join public.sessions s on s.id = a.session_id
    join public.seasons seasons on seasons.id = s.season_id
    left join public.session_player_charges spc
      on spc.session_id = a.session_id and spc.player_id = a.player_id
    group by a.player_id, s.season_id
  ),
  scored as (
    select g.scorer_id player_id, s.season_id, coalesce(sum(g.goal_count), 0)::integer goals
    from public.goals g join public.sessions s on s.id = g.session_id
    where coalesce(g.goal_type, 'goal') = 'goal'
    group by g.scorer_id, s.season_id
  ),
  assisted as (
    select g.assist_player_id player_id, s.season_id, count(g.id)::integer assists
    from public.goals g join public.sessions s on s.id = g.session_id
    where g.assist_player_id is not null and coalesce(g.goal_type, 'goal') = 'goal'
    group by g.assist_player_id, s.season_id
  ),
  completed_sessions as (
    select ranked.player_id, ranked.season_id,
      array_agg(ranked.session_label order by ranked.session_date desc, ranked.created_at desc) last_attended_sessions,
      max(ranked.session_label) filter (where ranked.rn = 1) latest_session
    from (
      select a.player_id, s.season_id, s.session_date, s.created_at,
        coalesce(nullif(s.name, ''), s.session_date::text) session_label,
        row_number() over (partition by a.player_id, s.season_id order by s.session_date desc, s.created_at desc) rn
      from public.attendance a join public.sessions s on s.id = a.session_id
      where a.status = 'played'
        or (a.status in ('replacement', 'confirmed')
          and (s.status = 'completed' or s.session_date < (now() at time zone 'America/Toronto')::date))
    ) ranked
    where ranked.rn <= 3
    group by ranked.player_id, ranked.season_id
  ),
  upcoming_sessions as (
    select player_id, season_id, session_label upcoming_session
    from (
      select a.player_id, s.season_id,
        coalesce(nullif(s.name, ''), s.session_date::text) session_label,
        row_number() over (partition by a.player_id, s.season_id order by s.session_date asc, s.created_at asc) rn
      from public.attendance a join public.sessions s on s.id = a.session_id
      where a.status in ('confirmed', 'waitlisted', 'replacement')
        and s.status = 'scheduled'
        and s.session_date >= (now() at time zone 'America/Toronto')::date
    ) ranked where rn = 1
  )
  select p.id, p.display_name, s.id, s.name,
    coalesce(ps.total_paid_amount, 0),
    coalesce(u.total_played_sessions, 0),
    coalesce(u.confirmed_sessions, 0),
    coalesce(u.estimated_used_amount, 0),
    coalesce(ps.credit_amount, 0),
    coalesce(ps.owes_money, 0),
    coalesce(ps.credit_amount, 0) - coalesce(ps.owes_money, 0),
    coalesce(sc.goals, 0), coalesce(ast.assists, 0),
    coalesce(u.total_played_sessions, 0)::integer,
    coalesce(cs.last_attended_sessions, array[]::text[]),
    cs.latest_session, ups.upcoming_session
  from public.players p
  cross join public.seasons s
  left join public.player_season_payment_summary ps
    on ps.player_id = p.id and ps.season_id = s.id
  left join signup_roster sr
    on sr.player_id = p.id::text and sr.season_id = s.id
      and sr.organization_id = p.organization_id
  left join attendance_usage u on u.player_id = p.id and u.season_id = s.id
  left join scored sc on sc.player_id = p.id and sc.season_id = s.id
  left join assisted ast on ast.player_id = p.id and ast.season_id = s.id
  left join completed_sessions cs on cs.player_id = p.id and cs.season_id = s.id
  left join upcoming_sessions ups on ups.player_id = p.id and ups.season_id = s.id
  where p.status = 'active' and p.organization_id = s.organization_id
    and (sr.player_id is not null
      or coalesce(ps.total_paid_amount, 0) > 0
      or coalesce(ps.credit_amount, 0) > 0
      or coalesce(ps.owes_money, 0) > 0
      or coalesce(u.total_played_sessions, 0) > 0
      or coalesce(u.confirmed_sessions, 0) > 0
      or coalesce(u.estimated_used_amount, 0) > 0
      or coalesce(sc.goals, 0) > 0
      or coalesce(ast.assists, 0) > 0
      or cs.latest_session is not null
      or ups.upcoming_session is not null)
  order by s.start_date desc nulls last, s.name, p.display_name;
$$;
