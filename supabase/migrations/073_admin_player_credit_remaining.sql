-- Player credit is calculated independently from the cash/expense dashboard.
-- Payments are authoritative for money received. The matching
-- ledger_entries.payment_received rows are intentionally excluded so that a
-- payment is never counted twice.
--
-- Session charges are authoritative for consumed credit. Ledger
-- session_used rows mirror those charges and are also intentionally excluded.
-- Completed refunds and credit transfers are sourced from the ledger because
-- they have no equivalent first-class table. A manual_adjustment amount is
-- signed: positive adds credit and negative removes credit.

create or replace view public.player_available_credit_summary
with (security_invoker = true) as
with payment_totals as (
  select
    p.organization_id,
    coalesce(p.program_id, s.program_id) as program_id,
    p.player_id,
    sum(coalesce(p.amount, 0))::numeric as payment_amount
  from public.payments p
  left join public.seasons s on s.id = p.season_id
  group by p.organization_id, coalesce(p.program_id, s.program_id), p.player_id
),
charge_totals as (
  select
    spc.organization_id,
    coalesce(spc.program_id, s.program_id) as program_id,
    spc.player_id,
    sum(coalesce(spc.amount, 0))::numeric as consumed_amount
  from public.session_player_charges spc
  join public.sessions s on s.id = spc.session_id
  join public.attendance a
    on a.session_id = spc.session_id
   and a.player_id = spc.player_id
  where s.status <> 'cancelled'
    and (
      a.status in ('played', 'replacement')
      or (
        a.status = 'confirmed'
        and (s.status = 'completed' or s.session_date < (now() at time zone 'America/Toronto')::date)
      )
    )
  group by spc.organization_id, coalesce(spc.program_id, s.program_id), spc.player_id
),
ledger_adjustments as (
  select
    le.organization_id,
    coalesce(le.program_id, s.program_id) as program_id,
    le.player_id,
    sum(
      case
        when le.type in ('credit_added', 'credit_transferred_in') then coalesce(le.amount, 0)
        when le.type in ('credit_transferred_out', 'refund_paid') then -coalesce(le.amount, 0)
        when le.type = 'manual_adjustment' then coalesce(le.amount, 0)
        else 0
      end
    )::numeric as adjustment_amount
  from public.ledger_entries le
  left join public.seasons s on s.id = le.season_id
  where le.type in (
    'credit_added',
    'credit_transferred_in',
    'credit_transferred_out',
    'refund_paid',
    'manual_adjustment'
  )
  group by le.organization_id, coalesce(le.program_id, s.program_id), le.player_id
),
account_keys as (
  select organization_id, program_id, player_id from payment_totals
  union
  select organization_id, program_id, player_id from charge_totals
  union
  select organization_id, program_id, player_id from ledger_adjustments
),
balances as (
  select
    k.organization_id,
    k.program_id,
    k.player_id,
    p.display_name as player_name,
    p.status as player_status,
    coalesce(pt.payment_amount, 0)::numeric as payment_amount,
    coalesce(ct.consumed_amount, 0)::numeric as consumed_amount,
    coalesce(la.adjustment_amount, 0)::numeric as adjustment_amount,
    (
      coalesce(pt.payment_amount, 0)
      - coalesce(ct.consumed_amount, 0)
      + coalesce(la.adjustment_amount, 0)
    )::numeric as balance_amount
  from account_keys k
  join public.players p on p.id = k.player_id
  left join payment_totals pt
    on pt.organization_id = k.organization_id
   and pt.program_id is not distinct from k.program_id
   and pt.player_id = k.player_id
  left join charge_totals ct
    on ct.organization_id = k.organization_id
   and ct.program_id is not distinct from k.program_id
   and ct.player_id = k.player_id
  left join ledger_adjustments la
    on la.organization_id = k.organization_id
   and la.program_id is not distinct from k.program_id
   and la.player_id = k.player_id
)
select
  organization_id,
  program_id,
  player_id,
  player_name,
  player_status,
  round(payment_amount, 2) as payment_amount,
  round(consumed_amount, 2) as consumed_amount,
  round(adjustment_amount, 2) as adjustment_amount,
  round(balance_amount, 2) as balance_amount,
  round(greatest(balance_amount, 0), 2) as available_credit_amount
from balances;

create or replace function public.admin_total_player_credit_remaining(
  p_program_id uuid default null
)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select round(coalesce(sum(credit.available_credit_amount), 0), 2)
  from public.player_available_credit_summary credit
  where p_program_id is null or credit.program_id = p_program_id;
$$;

grant select on public.player_available_credit_summary to authenticated;
grant execute on function public.admin_total_player_credit_remaining(uuid) to authenticated;

comment on view public.player_available_credit_summary is
  'Per-player, per-program available credit across all seasons. Positive balances are club liabilities; inactive players remain included.';

comment on function public.admin_total_player_credit_remaining(uuid) is
  'Sums positive player credit without allowing balances owed by other players to reduce the total.';

