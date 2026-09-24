alter table public.ledger_entries
  add column if not exists transfer_id uuid,
  add column if not exists transfer_date date,
  add column if not exists transfer_note text;

create unique index if not exists ledger_entries_transfer_pair_key
  on public.ledger_entries(transfer_id, type)
  where transfer_id is not null;

create or replace view public.player_season_transfer_summary
with (security_invoker = true) as
select organization_id, player_id, season_id,
  coalesce(sum(amount) filter (where type = 'credit_transferred_in'), 0)::numeric transfer_in_amount,
  coalesce(sum(amount) filter (where type = 'credit_transferred_out'), 0)::numeric transfer_out_amount
from public.ledger_entries
where type in ('credit_transferred_in', 'credit_transferred_out')
  and transfer_id is not null
group by organization_id, player_id, season_id;

grant select on public.player_season_transfer_summary to authenticated;

create or replace function public.carry_forward_player_credit(
  p_player_id uuid,
  p_source_season_id uuid,
  p_destination_season_id uuid,
  p_amount numeric,
  p_transfer_date date,
  p_note text,
  p_submission_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.seasons%rowtype;
  v_destination public.seasons%rowtype;
  v_balance numeric;
  v_existing public.ledger_entries%rowtype;
  v_transfer_id uuid := gen_random_uuid();
  v_out_id uuid;
  v_in_id uuid;
begin
  if p_submission_id is null then raise exception 'Submission ID is required'; end if;
  if p_source_season_id is null or p_destination_season_id is null
    or p_source_season_id = p_destination_season_id then
    raise exception 'Choose two different seasons';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Transfer amount must be positive and have at most two decimal places';
  end if;
  if p_transfer_date is null or p_transfer_date > (now() at time zone 'America/Toronto')::date then
    raise exception 'Enter a transfer date that is not in the future';
  end if;
  if length(coalesce(p_note, '')) > 300 then raise exception 'Transfer note is too long'; end if;

  select * into v_source from public.seasons where id = p_source_season_id;
  select * into v_destination from public.seasons where id = p_destination_season_id;
  if v_source.id is null or v_destination.id is null
    or v_source.organization_id is distinct from v_destination.organization_id
    or v_source.program_id is null
    or v_source.program_id is distinct from v_destination.program_id then
    raise exception 'Both seasons must belong to the same program and organization';
  end if;
  if public.organization_role(v_source.organization_id) is distinct from 'admin' then
    raise exception 'Only an organization admin can carry credit forward';
  end if;

  perform 1 from public.players p
  where p.id = p_player_id and p.organization_id = v_source.organization_id
  for update;
  if not found then raise exception 'Player was not found in this organization'; end if;

  select * into v_existing from public.ledger_entries
  where submission_id = p_submission_id;
  if found then
    if v_existing.type = 'credit_transferred_out'
      and v_existing.player_id = p_player_id
      and v_existing.season_id = p_source_season_id
      and v_existing.amount = p_amount
      and v_existing.transfer_date = p_transfer_date
      and v_existing.transfer_note is not distinct from nullif(btrim(p_note), '')
      and exists (
        select 1 from public.ledger_entries incoming
        where incoming.transfer_id = v_existing.transfer_id
          and incoming.type = 'credit_transferred_in'
          and incoming.player_id = p_player_id
          and incoming.season_id = p_destination_season_id
          and incoming.amount = p_amount
      ) then
      return v_existing.transfer_id;
    end if;
    raise exception 'Submission ID is already used for another transaction';
  end if;

  select credit_amount into v_balance
  from public.player_season_payment_summary
  where player_id = p_player_id and season_id = p_source_season_id;
  if coalesce(v_balance, 0) < p_amount then
    raise exception 'Transfer exceeds current source-season credit of %', coalesce(v_balance, 0);
  end if;

  insert into public.ledger_entries (
    organization_id, program_id, season_id, player_id, type, amount,
    sessions_count, transfer_id, transfer_date, transfer_note,
    submission_id, description, created_by
  ) values (
    v_source.organization_id, v_source.program_id, v_source.id, p_player_id,
    'credit_transferred_out', p_amount, 0, v_transfer_id, p_transfer_date,
    nullif(btrim(p_note), ''), p_submission_id,
    'Carried forward to ' || v_destination.name, auth.uid()
  ) returning id into v_out_id;

  insert into public.ledger_entries (
    organization_id, program_id, season_id, player_id, type, amount,
    sessions_count, transfer_id, transfer_date, transfer_note,
    description, created_by
  ) values (
    v_destination.organization_id, v_destination.program_id, v_destination.id, p_player_id,
    'credit_transferred_in', p_amount, 0, v_transfer_id, p_transfer_date,
    nullif(btrim(p_note), ''),
    'Carried forward from ' || v_source.name, auth.uid()
  ) returning id into v_in_id;

  insert into public.audit_logs (
    organization_id, actor_id, action, entity_type, entity_id, new_data
  ) values (
    v_source.organization_id, auth.uid(), 'player_credit_carried_forward',
    'ledger_entries', v_out_id,
    jsonb_build_object('transfer_id', v_transfer_id, 'out_entry_id', v_out_id,
      'in_entry_id', v_in_id, 'player_id', p_player_id,
      'source_season_id', v_source.id, 'destination_season_id', v_destination.id,
      'amount', p_amount, 'transfer_date', p_transfer_date,
      'note', nullif(btrim(p_note), ''))
  );
  return v_transfer_id;
end;
$$;

revoke all on function public.carry_forward_player_credit(uuid, uuid, uuid, numeric, date, text, uuid) from public, anon;
grant execute on function public.carry_forward_player_credit(uuid, uuid, uuid, numeric, date, text, uuid) to authenticated;
