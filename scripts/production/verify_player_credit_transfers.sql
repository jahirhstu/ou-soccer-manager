-- Read-only verification after deploying migration 080 and recording a transfer.
-- Replace NULL with the transfer UUID to inspect one transfer, or keep NULL for all.
with requested as (select null::uuid transfer_id)
select le.transfer_id, le.id ledger_entry_id, le.type, le.season_id, s.name season,
  le.player_id, p.display_name player_name, le.related_player_id, other.display_name counterparty,
  le.amount, le.session_id, le.transfer_date, le.transfer_note, le.submission_id, le.created_by
from public.ledger_entries le
join public.players p on p.id = le.player_id
join public.players other on other.id = le.related_player_id
join public.seasons s on s.id = le.season_id
cross join requested r
where le.transfer_id is not null and (r.transfer_id is null or le.transfer_id = r.transfer_id)
order by le.created_at desc, le.transfer_id, le.type;

-- Expect no rows: every player transfer must have exactly one balanced, reciprocal pair.
select transfer_id
from public.ledger_entries
where transfer_id is not null and related_player_id is not null
group by transfer_id
having count(*) <> 2
  or count(*) filter (where type = 'credit_transferred_out') <> 1
  or count(*) filter (where type = 'credit_transferred_in') <> 1
  or count(distinct season_id) <> 1
  or count(distinct organization_id) <> 1
  or count(distinct program_id) <> 1
  or min(player_id::text) filter (where type = 'credit_transferred_out')
    is distinct from min(related_player_id::text) filter (where type = 'credit_transferred_in')
  or min(player_id::text) filter (where type = 'credit_transferred_in')
    is distinct from min(related_player_id::text) filter (where type = 'credit_transferred_out')
  or sum(case when type = 'credit_transferred_in' then amount else -amount end) <> 0;

-- Inspect both sides' current balances. Receipts remain under their original payer.
select ps.*, ps.credit_amount - ps.owes_money balance_amount
from public.player_season_payment_summary ps
where exists (select 1 from public.ledger_entries le where le.transfer_id is not null
  and le.related_player_id is not null and le.player_id = ps.player_id and le.season_id = ps.season_id)
order by ps.season_name, ps.player_name;

select id, action, actor_id, new_data, created_at
from public.audit_logs where action = 'player_credit_transferred' order by created_at desc;
