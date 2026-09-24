-- Read-only checks after applying migration 075 and recording a transfer.
-- Replace the three UUIDs with the exact player, source season and destination season IDs.
with selected as (
  select '00000000-0000-0000-0000-000000000001'::uuid player_id,
    '00000000-0000-0000-0000-000000000002'::uuid source_season_id,
    '00000000-0000-0000-0000-000000000003'::uuid destination_season_id
)
select s.id season_id, s.name season_name, s.program_id,
  ps.credit_amount, ps.owes_money,
  coalesce(t.transfer_in_amount, 0) transfer_in_amount,
  coalesce(t.transfer_out_amount, 0) transfer_out_amount
from selected x
join public.seasons s on s.id in (x.source_season_id, x.destination_season_id)
left join public.player_season_payment_summary ps on ps.player_id = x.player_id and ps.season_id = s.id
left join public.player_season_transfer_summary t on t.player_id = x.player_id and t.season_id = s.id
order by s.name;

-- Every carry-forward operation must have one matching out and in entry,
-- for the same player and amount, between different seasons of one program.
select out_entry.transfer_id, out_entry.player_id, out_entry.amount,
  out_entry.season_id source_season_id, in_entry.season_id destination_season_id,
  source.program_id source_program_id, destination.program_id destination_program_id
from public.ledger_entries out_entry
left join public.ledger_entries in_entry
  on in_entry.transfer_id = out_entry.transfer_id and in_entry.type = 'credit_transferred_in'
left join public.seasons source on source.id = out_entry.season_id
left join public.seasons destination on destination.id = in_entry.season_id
where out_entry.type = 'credit_transferred_out' and out_entry.transfer_id is not null
  and (in_entry.id is null or out_entry.player_id is distinct from in_entry.player_id
    or out_entry.amount is distinct from in_entry.amount
    or source.program_id is distinct from destination.program_id
    or source.organization_id is distinct from destination.organization_id);

-- Club-wide carried-forward value must net to zero; no cash was received or sent.
select coalesce(sum(case when type = 'credit_transferred_in' then amount else -amount end), 0) net_transfer_amount
from public.ledger_entries
where transfer_id is not null and type in ('credit_transferred_in', 'credit_transferred_out');
