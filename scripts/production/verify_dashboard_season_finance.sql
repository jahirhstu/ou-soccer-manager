-- Read-only: run as an authenticated admin after applying migration 076.
-- Replace the season UUID with the exact season selected on the dashboard.
select * from public.admin_dashboard_season_finance('3d3e9d51-1f97-4899-8046-89ecac4cd1b4');

-- Player-level breakdown includes inactive players and counts each player once.
select ps.player_id, ps.player_name, p.status,
  ps.estimated_used_amount net_session_charges, ps.waived_amount,
  ps.credit_amount, ps.owes_money, ps.refund_paid_amount
from public.player_season_payment_summary ps
join public.players p on p.id = ps.player_id
where ps.season_id = '3d3e9d51-1f97-4899-8046-89ecac4cd1b4'
  and (ps.total_paid_amount <> 0 or ps.estimated_used_amount <> 0
    or ps.waived_amount <> 0 or ps.credit_amount <> 0 or ps.refund_paid_amount <> 0)
order by ps.player_name, ps.player_id;

-- Credit and waiver cards must equal the player-level totals exactly.
with totals as (
  select coalesce(sum(greatest(coalesce(credit_amount, 0), 0)), 0) credit,
    coalesce(sum(waived_amount), 0) waived
  from public.player_season_payment_summary
  where season_id = '3d3e9d51-1f97-4899-8046-89ecac4cd1b4'
)
select f.total_player_credit, t.credit player_credit_total,
  f.total_waived, t.waived player_waiver_total,
  f.net_club_balance, f.club_balance - t.credit expected_net_club_balance
from public.admin_dashboard_season_finance('3d3e9d51-1f97-4899-8046-89ecac4cd1b4') f
cross join totals t;

-- The renamed charge card retains its original public-report calculation.
select coalesce(sum(estimated_used_amount), 0) net_session_charges
from public.public_player_report()
where season_id = '3d3e9d51-1f97-4899-8046-89ecac4cd1b4';

select * from public.public_report_season('ou-soccer', null);
