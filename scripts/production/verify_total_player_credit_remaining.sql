-- Read-only production verification for migration 073.

-- 1. Player-level breakdown. Includes inactive players and zero/negative raw
-- balances; available_credit_amount floors each player at zero.
select
  organization_id,
  program_id,
  player_id,
  player_name,
  player_status,
  payment_amount,
  consumed_amount,
  adjustment_amount,
  balance_amount,
  available_credit_amount
from public.player_available_credit_summary
order by available_credit_amount desc, player_name;

-- 2. The card must exactly equal the sum of the displayed player breakdown.
-- Replace the program UUID or use null for the whole current organization.
with parameters as (
  select null::uuid as program_id
),
breakdown as (
  select coalesce(sum(credit.available_credit_amount), 0)::numeric as expected_total
  from public.player_available_credit_summary credit
  cross join parameters p
  where p.program_id is null or credit.program_id = p.program_id
)
select
  expected_total,
  public.admin_total_player_credit_remaining(parameters.program_id) as dashboard_total,
  expected_total = public.admin_total_player_credit_remaining(parameters.program_id) as totals_match
from breakdown
cross join parameters;

-- 3. Duplicate-counting guard: source counts stay separate. Joining payments,
-- charges, and adjustments directly would multiply rows; the view aggregates
-- each source before joining them.
select
  credit.player_id,
  credit.player_name,
  (select count(*) from public.payments p where p.player_id = credit.player_id) as payment_rows,
  (select count(*) from public.session_player_charges c where c.player_id = credit.player_id) as charge_rows,
  (select count(*) from public.ledger_entries le where le.player_id = credit.player_id) as ledger_rows,
  credit.payment_amount,
  credit.consumed_amount,
  credit.adjustment_amount,
  credit.available_credit_amount
from public.player_available_credit_summary credit
order by credit.player_name;

-- 4. Review completed refunds and signed manual adjustments included by the
-- calculation. refund_due is intentionally excluded until actually paid.
select id, player_id, program_id, season_id, type, amount, description, created_at
from public.ledger_entries
where type in (
  'refund_due',
  'refund_paid',
  'manual_adjustment',
  'credit_added',
  'credit_transferred_in',
  'credit_transferred_out'
)
order by created_at desc;

-- 5. Carried-forward credit: this exposes season activity while the dashboard
-- view groups all seasons by player and program.
select
  p.player_id,
  players.display_name,
  p.program_id,
  p.season_id,
  seasons.name as season_name,
  sum(p.amount)::numeric as paid_in_season
from public.payments p
join public.players players on players.id = p.player_id
join public.seasons seasons on seasons.id = p.season_id
group by p.player_id, players.display_name, p.program_id, p.season_id, seasons.name
order by players.display_name, seasons.start_date;
