-- REVIEW ONLY: this script has not been executed against production.
-- First run verify_fall_signup_import.sql and review the existing payments.
-- Fill the three NULL settings below after confirming the actual payment facts.
-- Run this entire script for a dry run. It ends in ROLLBACK.
-- After reviewing the results, replace ONLY the final ROLLBACK with COMMIT.
-- To reverse a committed repair, use rollback_fall_signup_import.sql.

begin;

create temporary table fall_signup_repair_settings (
  payment_date date,
  wali_paid boolean,
  mash_paid boolean
) on commit drop;
insert into fall_signup_repair_settings values (
  null::date,    -- Approved payment date; the original import was October 2, 2026.
  null::boolean, -- Wali: true only if $195 was received, otherwise false.
  null::boolean  -- Mash: true only if $195 was received, otherwise false.
);

create temporary table fall_signup_repair_players (
  player_id uuid primary key,
  reviewed_name text not null,
  amount numeric(10,2) not null,
  payment_id uuid,
  ledger_entry_id uuid,
  payment_created boolean not null default false,
  ledger_created boolean not null default false
) on commit drop;

-- UUIDs are the reviewed identities stored in this exact confirmed import.
-- Names are display labels, not matching criteria.
insert into fall_signup_repair_players (player_id, reviewed_name, amount) values
  ('2d4efe3c-6c74-4625-8172-7d40da278071', 'Jahir', 195),
  ('2e5e7d50-a455-44e5-9726-4083f26184d0', 'Shaiful', 195),
  ('4bdafed7-f2e5-48b2-8f9b-7c85cfbe91b4', 'Arnab', 195),
  ('b343f96b-209a-450b-a2fe-96dc8f24386b', 'Morshadul', 195),
  ('a8531627-98d7-461c-9d93-f8d337cac60f', 'Ahmed', 195),
  ('117951ab-ec68-4496-b7b2-34b984bac444', 'Sadat', 195),
  ('2b6b2647-8106-4173-8d86-a9110defa91f', 'Naveed', 195),
  ('9951c485-fbf2-4fa1-b0f1-c0b9d14e0de4', 'Shimul', 195),
  ('74f400d8-a9a4-40a0-ab97-47ca9e9448a4', 'Rafiul', 195),
  ('8cc45867-359a-448f-be8e-f7420b3e4e66', 'Rocky', 195),
  ('5b0dff7e-1db4-4088-9fec-42979ae8cdc6', 'Rokibul', 195),
  ('e4e465b2-9ca1-4e3d-a11c-a1edc8fa3063', 'Hazem', 195),
  ('4ddd3cfb-4685-4c17-af58-da1447156c0a', 'Towhid', 195),
  ('a56f197e-e4da-4af2-a982-7221deda219e', 'Shihan', 195),
  ('b60149ac-8450-4c2f-9cdb-0a7d21a54c4f', 'Wali', 195),
  ('c093216f-e4e8-431f-a0bf-213a531bf376', 'Mash', 195),
  ('7718943f-36f0-4bbb-b678-32d863bbdfff', 'Mustaqim', 195),
  ('c359f547-4a68-4747-843e-72e23c367e99', 'Arif', 195),
  ('429ccc2d-65a9-4a37-8eb8-3b2f2388f696', 'Moshee', 195),
  ('51279442-8e16-43c2-b4b5-82f0657c3d9b', 'Shafayet', 195),
  ('6b71ebee-4acc-440a-9d96-368216e88ee6', 'Shomi', 123);

do $$
begin
  if exists (select 1 from fall_signup_repair_settings
    where payment_date is null or wali_paid is null or mash_paid is null) then
    raise exception 'Confirm payment_date, wali_paid, and mash_paid before running this repair';
  end if;
end;
$$;

delete from fall_signup_repair_players r
using fall_signup_repair_settings settings
where (r.player_id = 'b60149ac-8450-4c2f-9cdb-0a7d21a54c4f' and not settings.wali_paid)
  or (r.player_id = 'c093216f-e4e8-431f-a0bf-213a531bf376' and not settings.mash_paid);

-- Serialize the financial check and inserts, including against ordinary imports.
lock table public.payments, public.ledger_entries in share row exclusive mode;

create temporary table fall_signup_balances_before on commit drop as
select ps.* from public.player_season_payment_summary ps
join fall_signup_repair_players r on r.player_id = ps.player_id;

-- Preview the approved amounts and all existing Fall balances before changes.
select r.player_id, r.reviewed_name, r.amount amount_to_record,
  settings.payment_date, ps.total_paid_amount existing_paid,
  ps.credit_amount - ps.owes_money existing_balance
from fall_signup_repair_players r
cross join fall_signup_repair_settings settings
left join public.player_season_payment_summary ps on ps.player_id = r.player_id
  and ps.season_id = '6c14cad3-7174-46e3-8598-3de6196e58b9'::uuid
order by r.reviewed_name;

do $$
declare
  v_import public.whatsapp_imports%rowtype;
  v_season public.seasons%rowtype;
  v_player record;
  v_payment public.payments%rowtype;
  v_ledger public.ledger_entries%rowtype;
  v_payment_created boolean;
  v_ledger_created boolean;
  v_actor uuid;
  v_payment_date date;
  v_reference text := 'WhatsApp import debbe090-b907-472a-bb74-6718d5860a6f: Paid';
  v_recovery_tag text := 'fall_signup_debbe090_20261002';
begin
  select * into v_import from public.whatsapp_imports
  where id = 'debbe090-b907-472a-bb74-6718d5860a6f'::uuid for update;
  select * into v_season from public.seasons
  where id = '6c14cad3-7174-46e3-8598-3de6196e58b9'::uuid for update;
  if v_import.id is null or v_season.id is null
    or v_import.status <> 'confirmed'
    or v_import.parsed_json ->> 'importType' is distinct from 'season_signup'
    or v_import.season_id is distinct from v_season.id
    or v_import.organization_id is distinct from v_season.organization_id then
    raise exception 'The expected confirmed Fall signup import and organization do not match';
  end if;
  v_actor := coalesce(v_import.confirmed_by, v_import.created_by);
  if v_actor is null then raise exception 'Original importer profile is missing'; end if;
  select payment_date into v_payment_date from fall_signup_repair_settings;

  for v_player in select * from fall_signup_repair_players order by player_id loop
    if not exists (select 1 from public.players p
      where p.id = v_player.player_id and p.organization_id = v_season.organization_id)
      or not exists (
        select 1 from jsonb_array_elements(v_import.parsed_json -> 'players') player
        where player ->> 'matchedPlayerId' = v_player.player_id::text
      ) or (select count(*) from jsonb_array_elements(v_import.parsed_json -> 'payments') payment
        where payment ->> 'matchedPlayerId' = v_player.player_id::text
          and (payment ->> 'amount')::numeric = v_player.amount
          and payment ->> 'amountSource' = 'player_line'
          and payment ->> 'paymentMethod' = 'e-transfer') <> 1 then
      raise exception 'Reviewed UUID or payment amount does not match the saved import for %', v_player.player_id;
    end if;

    -- Stop for any unrelated payment; an admin must distinguish it before recovery.
    if exists (select 1 from public.payments p
      where p.player_id = v_player.player_id and p.season_id = v_season.id
        and p.reference_note is distinct from v_reference) then
      raise exception 'Another Fall payment exists for %. Review it before recovery', v_player.player_id;
    end if;
    if (select count(*) from public.payments p where p.player_id = v_player.player_id
      and p.season_id = v_season.id and p.reference_note = v_reference) > 1 then
      raise exception 'Duplicate payments already exist for %', v_player.player_id;
    end if;

    select * into v_payment from public.payments p where p.player_id = v_player.player_id
      and p.season_id = v_season.id and p.reference_note = v_reference;
    v_payment_created := v_payment.id is null;
    if v_payment_created then
      insert into public.payments(organization_id, program_id, season_id, session_id,
        player_id, amount, sessions_covered, payment_date, payment_method, reference_note, created_by)
      values (v_season.organization_id, v_season.program_id, v_season.id, null,
        v_player.player_id, v_player.amount, null, v_payment_date, 'e-transfer', v_reference, v_actor)
      returning * into v_payment;
    elsif v_payment.amount is distinct from v_player.amount or v_payment.payment_date is distinct from v_payment_date
      or v_payment.payment_method is distinct from 'e-transfer' or v_payment.session_id is not null then
      raise exception 'Existing payment differs from the approved recovery for %', v_player.player_id;
    end if;

    if (select count(*) from public.ledger_entries le where le.player_id = v_player.player_id
      and le.season_id = v_season.id and le.type = 'payment_received' and le.description = v_reference) > 1 then
      raise exception 'Duplicate payment ledgers already exist for %', v_player.player_id;
    end if;
    select * into v_ledger from public.ledger_entries le where le.player_id = v_player.player_id
      and le.season_id = v_season.id and le.type = 'payment_received' and le.description = v_reference;
    v_ledger_created := v_ledger.id is null;
    if v_ledger_created then
      insert into public.ledger_entries(organization_id, program_id, season_id, player_id,
        session_id, type, amount, sessions_count, description, created_by)
      values (v_season.organization_id, v_season.program_id, v_season.id, v_player.player_id,
        null, 'payment_received', v_player.amount, null, v_reference, v_actor)
      returning * into v_ledger;
    elsif v_ledger.amount is distinct from v_player.amount or v_ledger.session_id is not null then
      raise exception 'Existing payment ledger differs for %', v_player.player_id;
    end if;

    update fall_signup_repair_players set payment_id = v_payment.id, ledger_entry_id = v_ledger.id,
      payment_created = v_payment_created, ledger_created = v_ledger_created
    where player_id = v_player.player_id;
    if v_payment_created or v_ledger_created then
      insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, new_data)
      values (v_season.organization_id, v_actor, 'payment_import_recovered', 'payments', v_payment.id,
        jsonb_build_object('import_id', v_import.id, 'recovery_tag', v_recovery_tag,
          'player_id', v_player.player_id, 'season_id', v_season.id,
          'payment_id', v_payment.id, 'ledger_entry_id', v_ledger.id,
          'amount', v_player.amount, 'payment_date', v_payment_date,
          'payment_created', v_payment_created, 'ledger_created', v_ledger_created));
    end if;
  end loop;

  -- Cash and ledger receipts are not counted twice in the balance view.
  if exists (
    select 1 from fall_signup_repair_players r
    join fall_signup_balances_before before on before.player_id = r.player_id and before.season_id = v_season.id
    join public.player_season_payment_summary after on after.player_id = r.player_id and after.season_id = v_season.id
    where (after.credit_amount - after.owes_money) - (before.credit_amount - before.owes_money)
      <> case when r.payment_created then r.amount else 0 end
  ) then raise exception 'Recovered player balances do not reconcile'; end if;
  if exists (
    select 1 from fall_signup_balances_before before
    join public.player_season_payment_summary after using (player_id, season_id)
    where before.season_id <> v_season.id and to_jsonb(before) is distinct from to_jsonb(after)
  ) then raise exception 'A historical season balance changed'; end if;
end;
$$;

-- Final preview: newly created IDs, cash amounts, and the resulting balances.
select r.reviewed_name, r.player_id, r.payment_id, r.ledger_entry_id,
  r.payment_created, r.ledger_created, ps.total_paid_amount,
  ps.credit_amount, ps.owes_money, ps.credit_amount - ps.owes_money balance_amount
from fall_signup_repair_players r
join public.player_season_payment_summary ps on ps.player_id = r.player_id
  and ps.season_id = '6c14cad3-7174-46e3-8598-3de6196e58b9'::uuid
order by r.reviewed_name;

-- Default is a dry run. Change this to COMMIT only after reviewing the result.
rollback;
