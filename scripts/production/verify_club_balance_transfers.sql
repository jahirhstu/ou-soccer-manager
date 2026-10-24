-- Read-only reconciliation after migration 078. No transfer is created here.
select organization_id, program_id, count(*) unassigned_expenses
from public.club_expenses
where season_id is null
group by organization_id, program_id
order by organization_id, program_id;

-- Every transfer and reversal should stay within one program and move forward.
select t.id, t.source_season_id, t.destination_season_id, t.amount, t.reverses_transfer_id
from public.club_balance_transfers t
join public.seasons source on source.id = t.source_season_id
join public.seasons destination on destination.id = t.destination_season_id
where source.organization_id is distinct from destination.organization_id
  or source.program_id is distinct from destination.program_id
  or destination.start_date <= source.start_date;

-- Transfers are internal: signed source and destination effects must net to zero.
with movements as (
  select organization_id, program_id, source_season_id season_id, -amount delta
  from public.club_balance_transfers
  union all
  select organization_id, program_id, destination_season_id season_id, amount delta
  from public.club_balance_transfers
)
select organization_id, program_id, coalesce(sum(delta), 0) net_transfer_effect
from movements
group by organization_id, program_id
having coalesce(sum(delta), 0) <> 0;

-- Originals and reversals must cancel exactly.
select original.id, original.amount original_amount, reversal.amount reversal_amount
from public.club_balance_transfers reversal
join public.club_balance_transfers original on original.id = reversal.reverses_transfer_id
where original.amount + reversal.amount <> 0;
