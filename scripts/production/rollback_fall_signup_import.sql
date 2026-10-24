-- REVIEW ONLY: reverse only the UUIDs created by repair_fall_signup_import.sql.
-- Original receipts and historical attendance are never removed.
-- Dry run by default. Review the balances before changing ROLLBACK to COMMIT.
begin;
lock table public.payments, public.ledger_entries in share row exclusive mode;

do $$
declare
  v_audit public.audit_logs%rowtype;
  v_payment public.payments%rowtype;
  v_ledger public.ledger_entries%rowtype;
begin
  for v_audit in
    select a.* from public.audit_logs a
    where a.action = 'payment_import_recovered'
      and a.new_data ->> 'recovery_tag' = 'fall_signup_debbe090_20261002'
      and not exists (select 1 from public.audit_logs reversed
        where reversed.action = 'payment_import_recovery_reversed'
          and reversed.new_data ->> 'recovery_audit_id' = a.id::text)
    order by a.id for update
  loop
    select * into v_payment from public.payments
      where id = (v_audit.new_data ->> 'payment_id')::uuid;
    select * into v_ledger from public.ledger_entries
      where id = (v_audit.new_data ->> 'ledger_entry_id')::uuid;
    if (v_audit.new_data ->> 'payment_created')::boolean and (
      v_payment.id is null
      or v_payment.player_id::text is distinct from v_audit.new_data ->> 'player_id'
      or v_payment.season_id::text is distinct from v_audit.new_data ->> 'season_id'
      or v_payment.amount is distinct from (v_audit.new_data ->> 'amount')::numeric
      or v_payment.payment_date is distinct from (v_audit.new_data ->> 'payment_date')::date
      or v_payment.reference_note is distinct from 'WhatsApp import debbe090-b907-472a-bb74-6718d5860a6f: Paid'
      or exists (select 1 from public.notifications n where n.payment_id = v_payment.id)
    ) then raise exception 'Recovered payment % changed or acquired a dependent record; review before reversing', v_payment.id; end if;
    if (v_audit.new_data ->> 'ledger_created')::boolean and (
      v_ledger.id is null
      or v_ledger.player_id::text is distinct from v_audit.new_data ->> 'player_id'
      or v_ledger.season_id::text is distinct from v_audit.new_data ->> 'season_id'
      or v_ledger.amount is distinct from (v_audit.new_data ->> 'amount')::numeric
      or v_ledger.type is distinct from 'payment_received'
      or v_ledger.description is distinct from 'WhatsApp import debbe090-b907-472a-bb74-6718d5860a6f: Paid'
      or exists (select 1 from public.session_player_charges c where c.ledger_entry_id = v_ledger.id)
    ) then raise exception 'Recovered ledger % changed or acquired a dependent record; review before reversing', v_ledger.id; end if;

    if (v_audit.new_data ->> 'ledger_created')::boolean then
      delete from public.ledger_entries where id = v_ledger.id;
    end if;
    if (v_audit.new_data ->> 'payment_created')::boolean then
      delete from public.payments where id = v_payment.id;
    end if;
    insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, old_data, new_data)
    values (v_audit.organization_id, v_audit.actor_id, 'payment_import_recovery_reversed',
      'payments', v_audit.entity_id, v_audit.new_data,
      jsonb_build_object('recovery_audit_id', v_audit.id, 'recovery_tag', 'fall_signup_debbe090_20261002'));
  end loop;
end;
$$;

select ps.player_id, ps.player_name, ps.total_paid_amount,
  ps.credit_amount, ps.owes_money, ps.credit_amount - ps.owes_money balance_amount
from public.player_season_payment_summary ps
where ps.season_id = '6c14cad3-7174-46e3-8598-3de6196e58b9'::uuid
  and exists (select 1 from public.audit_logs a
    where a.action = 'payment_import_recovered'
      and a.new_data ->> 'recovery_tag' = 'fall_signup_debbe090_20261002'
      and a.new_data ->> 'player_id' = ps.player_id::text)
order by ps.player_name;

rollback;
