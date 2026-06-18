alter table public.session_player_charges
  add column if not exists original_amount numeric(10,2),
  add column if not exists waiver_amount numeric(10,2) not null default 0,
  add column if not exists waiver_reason text,
  add column if not exists waived_by uuid references public.profiles(id),
  add column if not exists waived_at timestamptz;

update public.session_player_charges
set original_amount = amount
where original_amount is null;

alter table public.session_player_charges
  drop constraint if exists session_player_charges_amount_nonnegative,
  drop constraint if exists session_player_charges_original_amount_nonnegative,
  drop constraint if exists session_player_charges_waiver_amount_valid,
  drop constraint if exists session_player_charges_waiver_reason_required;

alter table public.session_player_charges
  alter column original_amount set not null,
  add constraint session_player_charges_amount_nonnegative check (amount >= 0),
  add constraint session_player_charges_original_amount_nonnegative check (original_amount >= 0),
  add constraint session_player_charges_waiver_amount_valid check (waiver_amount >= 0 and waiver_amount <= original_amount),
  add constraint session_player_charges_waiver_reason_required check (waiver_amount = 0 or nullif(btrim(waiver_reason), '') is not null);

alter table public.ledger_entries drop constraint if exists ledger_entries_type_check;
alter table public.ledger_entries
  add constraint ledger_entries_type_check check (
    type in (
      'payment_received',
      'session_used',
      'fee_waived',
      'credit_added',
      'credit_transferred_out',
      'credit_transferred_in',
      'refund_due',
      'refund_paid',
      'manual_adjustment'
    )
  );

create or replace view public.player_season_payment_summary
with (security_invoker = true) as
with payment_totals as (
  select player_id, season_id, coalesce(sum(amount),0) total_paid_amount, coalesce(sum(sessions_covered),0) total_paid_sessions
  from public.payments group by player_id, season_id
),
usage as (
  select
    a.player_id,
    s.season_id,
    count(*) filter (where a.status in ('played','replacement'))::numeric total_played_sessions,
    coalesce(sum(
      case
        when a.status in ('played','replacement') then coalesce(spc.amount, s.price_per_session, seasons.price_per_session)
        else 0
      end
    ),0) estimated_used_amount,
    coalesce(sum(
      case
        when a.status in ('played','replacement') then coalesce(spc.waiver_amount, 0)
        else 0
      end
    ),0) waived_amount
  from public.attendance a
  join public.sessions s on s.id = a.session_id
  join public.seasons seasons on seasons.id = s.season_id
  left join public.session_player_charges spc on spc.session_id = a.session_id and spc.player_id = a.player_id
  group by a.player_id, s.season_id
),
refunds as (
  select player_id, season_id, coalesce(sum(amount) filter (where type = 'refund_due'),0) refund_due_amount
  from public.ledger_entries group by player_id, season_id
)
select
  p.id player_id,
  p.display_name player_name,
  s.id season_id,
  s.name season_name,
  coalesce(pt.total_paid_amount,0) total_paid_amount,
  coalesce(pt.total_paid_sessions,0) total_paid_sessions,
  coalesce(u.total_played_sessions,0) total_played_sessions,
  greatest(coalesce(pt.total_paid_sessions,0) - coalesce(u.total_played_sessions,0), 0) remaining_sessions,
  coalesce(u.estimated_used_amount,0) estimated_used_amount,
  greatest(coalesce(pt.total_paid_amount,0) - coalesce(u.estimated_used_amount,0), 0) credit_amount,
  coalesce(r.refund_due_amount,0) refund_due_amount,
  greatest(coalesce(u.estimated_used_amount,0) - coalesce(pt.total_paid_amount,0), 0) owes_money,
  coalesce(u.waived_amount,0) waived_amount
from public.players p
cross join public.seasons s
left join payment_totals pt on pt.player_id = p.id and pt.season_id = s.id
left join usage u on u.player_id = p.id and u.season_id = s.id
left join refunds r on r.player_id = p.id and r.season_id = s.id;

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
  usage as (
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
      coalesce(sum(
        case
          when a.status in ('played','replacement')
            or (a.status = 'confirmed' and (s.status = 'completed' or s.session_date < (now() at time zone 'America/Toronto')::date))
          then coalesce(spc.amount, s.price_per_session, seasons.price_per_session)
          else 0
        end
      ),0) estimated_used_amount
    from public.attendance a
    join public.sessions s on s.id = a.session_id
    join public.seasons seasons on seasons.id = s.season_id
    left join public.session_player_charges spc on spc.session_id = a.session_id and spc.player_id = a.player_id
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
