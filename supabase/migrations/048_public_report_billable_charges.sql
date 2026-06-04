drop function if exists public.public_player_report();

create or replace function public.public_player_report()
returns table(
  player_id uuid,
  player_name text,
  season_id uuid,
  season_name text,
  total_paid_amount numeric,
  total_played_sessions numeric,
  confirmed_sessions numeric,
  estimated_used_amount numeric,
  credit_amount numeric,
  owes_money numeric,
  balance_amount numeric,
  goals integer,
  assists integer,
  appearances integer,
  last_attended_sessions text[],
  latest_session text,
  upcoming_session text
)
language sql stable security definer set search_path = public as $$
  with payment_totals as (
    select pay.player_id, pay.season_id, coalesce(sum(pay.amount),0) total_paid_amount
    from public.payments pay
    group by pay.player_id, pay.season_id
  ),
  attendance_usage as (
    select
      a.player_id,
      s.season_id,
      count(*) filter (
        where a.status in ('played','replacement')
          or (a.status = 'confirmed' and (s.status = 'completed' or s.session_date < (now() at time zone 'America/Toronto')::date))
      )::numeric total_played_sessions,
      count(*) filter (
        where a.status in ('confirmed','waitlisted')
          and s.status = 'scheduled'
          and s.session_date >= (now() at time zone 'America/Toronto')::date
      )::numeric confirmed_sessions,
      coalesce(sum(coalesce(s.price_per_session, seasons.price_per_session)) filter (
        where a.status in ('played','replacement')
          or (a.status = 'confirmed' and (s.status = 'completed' or s.session_date < (now() at time zone 'America/Toronto')::date))
      ),0) attendance_used_amount
    from public.attendance a
    join public.sessions s on s.id = a.session_id
    join public.seasons seasons on seasons.id = s.season_id
    group by a.player_id, s.season_id
  ),
  charged_usage as (
    select
      spc.player_id,
      spc.season_id,
      coalesce(sum(spc.amount), 0) charged_used_amount
    from public.session_player_charges spc
    join public.attendance a on a.session_id = spc.session_id and a.player_id = spc.player_id
    where a.status in ('confirmed','played','replacement')
    group by spc.player_id, spc.season_id
  ),
  usage as (
    select
      coalesce(au.player_id, cu.player_id) player_id,
      coalesce(au.season_id, cu.season_id) season_id,
      coalesce(au.total_played_sessions, 0) total_played_sessions,
      coalesce(au.confirmed_sessions, 0) confirmed_sessions,
      greatest(coalesce(au.attendance_used_amount, 0), coalesce(cu.charged_used_amount, 0)) estimated_used_amount
    from attendance_usage au
    full join charged_usage cu on cu.player_id = au.player_id and cu.season_id = au.season_id
  ),
  scored as (
    select g.scorer_id as player_id, s.season_id, coalesce(sum(g.goal_count),0)::integer goals
    from public.goals g
    join public.sessions s on s.id = g.session_id
    where coalesce(g.goal_type, 'goal') = 'goal'
    group by g.scorer_id, s.season_id
  ),
  assisted as (
    select g.assist_player_id as player_id, s.season_id, count(g.id)::integer assists
    from public.goals g
    join public.sessions s on s.id = g.session_id
    where g.assist_player_id is not null
      and coalesce(g.goal_type, 'goal') = 'goal'
    group by g.assist_player_id, s.season_id
  ),
  completed_sessions as (
    select
      ranked.player_id,
      ranked.season_id,
      array_agg(ranked.session_label order by ranked.session_date desc, ranked.created_at desc) last_attended_sessions,
      max(ranked.session_label) filter (where ranked.rn = 1) latest_session
    from (
      select
        a.player_id,
        s.season_id,
        s.session_date,
        s.created_at,
        coalesce(nullif(s.name, ''), s.session_date::text) session_label,
        row_number() over (partition by a.player_id, s.season_id order by s.session_date desc, s.created_at desc) rn
      from public.attendance a
      join public.sessions s on s.id = a.session_id
      where (
          a.status = 'played'
          or (a.status = 'replacement' and (s.status = 'completed' or s.session_date < (now() at time zone 'America/Toronto')::date))
          or (a.status = 'confirmed' and (s.status = 'completed' or s.session_date < (now() at time zone 'America/Toronto')::date))
        )
    ) ranked
    where ranked.rn <= 3
    group by ranked.player_id, ranked.season_id
  ),
  upcoming_sessions as (
    select player_id, season_id, session_label upcoming_session
    from (
      select
        a.player_id,
        s.season_id,
        coalesce(nullif(s.name, ''), s.session_date::text) session_label,
        row_number() over (partition by a.player_id, s.season_id order by s.session_date asc, s.created_at asc) rn
      from public.attendance a
      join public.sessions s on s.id = a.session_id
      where a.status in ('confirmed','waitlisted','replacement')
        and s.status = 'scheduled'
        and s.session_date >= (now() at time zone 'America/Toronto')::date
    ) ranked
    where ranked.rn = 1
  )
  select
    p.id player_id,
    p.display_name player_name,
    s.id season_id,
    s.name season_name,
    coalesce(pt.total_paid_amount,0) total_paid_amount,
    coalesce(u.total_played_sessions,0) total_played_sessions,
    coalesce(u.confirmed_sessions,0) confirmed_sessions,
    coalesce(u.estimated_used_amount,0) estimated_used_amount,
    greatest(coalesce(pt.total_paid_amount,0) - coalesce(u.estimated_used_amount,0), 0) credit_amount,
    greatest(coalesce(u.estimated_used_amount,0) - coalesce(pt.total_paid_amount,0), 0) owes_money,
    coalesce(pt.total_paid_amount,0) - coalesce(u.estimated_used_amount,0) balance_amount,
    coalesce(sc.goals,0) goals,
    coalesce(ast.assists,0) assists,
    coalesce(u.total_played_sessions,0)::integer appearances,
    coalesce(cs.last_attended_sessions, array[]::text[]) last_attended_sessions,
    cs.latest_session,
    ups.upcoming_session
  from public.players p
  cross join public.seasons s
  left join payment_totals pt on pt.player_id = p.id and pt.season_id = s.id
  left join usage u on u.player_id = p.id and u.season_id = s.id
  left join scored sc on sc.player_id = p.id and sc.season_id = s.id
  left join assisted ast on ast.player_id = p.id and ast.season_id = s.id
  left join completed_sessions cs on cs.player_id = p.id and cs.season_id = s.id
  left join upcoming_sessions ups on ups.player_id = p.id and ups.season_id = s.id
  where p.status = 'active'
    and (
      coalesce(pt.total_paid_amount,0) > 0
      or coalesce(u.total_played_sessions,0) > 0
      or coalesce(u.confirmed_sessions,0) > 0
      or coalesce(u.estimated_used_amount,0) > 0
      or coalesce(sc.goals,0) > 0
      or coalesce(ast.assists,0) > 0
      or cs.latest_session is not null
      or ups.upcoming_session is not null
    )
  order by s.start_date desc nulls last, s.name, p.display_name;
$$;

grant execute on function public.public_player_report() to anon, authenticated, service_role;
