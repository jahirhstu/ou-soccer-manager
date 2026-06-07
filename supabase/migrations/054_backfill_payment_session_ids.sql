-- Backfill the new payments.session_id column from historical payment ledger rows.
-- Business rule: signup payments stay sessionless; drop-in/session payments should
-- point at the session they were collected for.

with note_matches as (
  select
    p.id as payment_id,
    le.session_id,
    count(*) over (partition by p.id) as candidate_count
  from public.payments p
  join public.ledger_entries le
    on le.season_id = p.season_id
   and le.player_id = p.player_id
   and le.type = 'payment_received'
   and le.session_id is not null
   and le.amount is not distinct from p.amount
   and le.sessions_count is not distinct from p.sessions_covered
   and le.description is not distinct from p.reference_note
   and le.organization_id = p.organization_id
  where p.session_id is null
)
update public.payments p
set session_id = note_matches.session_id
from note_matches
where p.id = note_matches.payment_id
  and note_matches.candidate_count = 1;

with candidate_matches as (
  select
    p.id as payment_id,
    le.session_id,
    count(*) over (partition by p.id) as candidate_count
  from public.payments p
  join public.ledger_entries le
    on le.season_id = p.season_id
   and le.player_id = p.player_id
   and le.type = 'payment_received'
   and le.session_id is not null
   and le.amount is not distinct from p.amount
   and le.sessions_count is not distinct from p.sessions_covered
   and le.organization_id = p.organization_id
   and le.created_by is not distinct from p.created_by
   and le.created_at between p.created_at - interval '5 minutes' and p.created_at + interval '5 minutes'
  where p.session_id is null
)
update public.payments p
set session_id = candidate_matches.session_id
from candidate_matches
where p.id = candidate_matches.payment_id
  and candidate_matches.candidate_count = 1;
