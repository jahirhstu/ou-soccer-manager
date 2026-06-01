drop function if exists public.public_player_report();

create or replace function public.public_player_report()
returns table(
  player_id uuid,
  player_name text,
  season_id uuid,
  season_name text,
  total_paid_amount numeric,
  total_played_sessions numeric,
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
  played as (
    select
      a.player_id,
      s.season_id,
      count(*) filter (where a.status in ('played','replacement'))::numeric total_played_sessions,
      coalesce(sum(coalesce(s.price_per_session, seasons.price_per_session)) filter (where a.status in ('played','replacement')),0) estimated_used_amount
    from public.attendance a
    join public.sessions s on s.id = a.session_id
    join public.seasons seasons on seasons.id = s.season_id
    group by a.player_id, s.season_id
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
      where a.status in ('played','replacement')
        and s.status = 'completed'
        and s.session_date <= current_date
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
      where a.status in ('confirmed','waitlisted')
        and s.status = 'scheduled'
        and s.session_date >= current_date
    ) ranked
    where ranked.rn = 1
  )
  select
    p.id player_id,
    p.display_name player_name,
    s.id season_id,
    s.name season_name,
    coalesce(pt.total_paid_amount,0) total_paid_amount,
    coalesce(pl.total_played_sessions,0) total_played_sessions,
    coalesce(pl.estimated_used_amount,0) estimated_used_amount,
    greatest(coalesce(pt.total_paid_amount,0) - coalesce(pl.estimated_used_amount,0), 0) credit_amount,
    greatest(coalesce(pl.estimated_used_amount,0) - coalesce(pt.total_paid_amount,0), 0) owes_money,
    coalesce(pt.total_paid_amount,0) - coalesce(pl.estimated_used_amount,0) balance_amount,
    coalesce(sc.goals,0) goals,
    coalesce(ast.assists,0) assists,
    coalesce(pl.total_played_sessions,0)::integer appearances,
    coalesce(cs.last_attended_sessions, array[]::text[]) last_attended_sessions,
    cs.latest_session,
    ups.upcoming_session
  from public.players p
  cross join public.seasons s
  left join payment_totals pt on pt.player_id = p.id and pt.season_id = s.id
  left join played pl on pl.player_id = p.id and pl.season_id = s.id
  left join scored sc on sc.player_id = p.id and sc.season_id = s.id
  left join assisted ast on ast.player_id = p.id and ast.season_id = s.id
  left join completed_sessions cs on cs.player_id = p.id and cs.season_id = s.id
  left join upcoming_sessions ups on ups.player_id = p.id and ups.season_id = s.id
  where p.status = 'active'
    and (
      coalesce(pt.total_paid_amount,0) > 0
      or coalesce(pl.total_played_sessions,0) > 0
      or coalesce(sc.goals,0) > 0
      or coalesce(ast.assists,0) > 0
    )
  order by s.start_date desc nulls last, s.name, p.display_name;
$$;

grant execute on function public.public_player_report() to anon, authenticated, service_role;
