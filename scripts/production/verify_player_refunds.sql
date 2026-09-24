-- Read-only checks after applying migration 074 and recording refunds.
-- Set the season_id below to the season being reconciled.

with target as (
  select '3d3e9d51-1f97-4899-8046-89ecac4cd1b4'::uuid season_id
)
select ps.player_id, ps.player_name, ps.season_name,
  ps.total_paid_amount, ps.estimated_used_amount,
  ps.refund_paid_amount, ps.credit_amount, ps.owes_money
from public.player_season_payment_summary ps
join target t on t.season_id = ps.season_id
where ps.total_paid_amount <> 0 or ps.estimated_used_amount <> 0
   or ps.refund_paid_amount <> 0
order by ps.player_name, ps.player_id;

with target as (
  select '3d3e9d51-1f97-4899-8046-89ecac4cd1b4'::uuid season_id
)
select le.id, le.player_id, le.amount, le.refund_date, le.refund_method,
  le.refund_reference, le.submission_id, le.created_at, le.created_by
from public.ledger_entries le
join target t on t.season_id = le.season_id
where le.type = 'refund_paid'
order by le.refund_date, le.id;

-- Every completed refund should have exactly one submission ID and the
-- dashboard total should equal the sum of positive season credits.
select submission_id, count(*) as rows_with_id
from public.ledger_entries
where type = 'refund_paid' and submission_id is not null
group by submission_id
having count(*) > 1;

select
  public.admin_total_player_credit_remaining(null::uuid) dashboard_total,
  coalesce(sum(ps.credit_amount), 0) player_credit_total
from public.player_season_payment_summary ps;

-- Public and admin balances should agree for active players in the season.
with target as (
  select '3d3e9d51-1f97-4899-8046-89ecac4cd1b4'::uuid season_id
)
select pr.player_id, pr.player_name,
  pr.balance_amount public_balance,
  ps.credit_amount - ps.owes_money admin_balance
from public.public_player_report() pr
join public.player_season_payment_summary ps
  on ps.player_id = pr.player_id and ps.season_id = pr.season_id
join target t on t.season_id = pr.season_id
where pr.balance_amount is distinct from ps.credit_amount - ps.owes_money;
