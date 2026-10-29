-- Integrate main's financial workflows with development's program authority.
-- Keep the original financial calculations and idempotency checks intact.
create or replace function public.can_manage_program_finance(p_program_id uuid, p_module text default 'payments')
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth.uid() is not null
    and public.program_role(p.id) = 'manager'
    and public.is_program_module_enabled(p.id, p_module)
    and o.onboarding_status = 'active'
    and (public.has_platform_organization_access(o.id) or exists (
      select 1 from public.organization_members m
      where m.organization_id = o.id and m.profile_id = auth.uid() and m.status = 'active'
    )), false)
  from public.programs p join public.organizations o on o.id = p.organization_id
  where p.id = p_program_id;
$$;
revoke all on function public.can_manage_program_finance(uuid, text) from public, anon;
grant execute on function public.can_manage_program_finance(uuid, text) to authenticated;

create or replace function public.record_player_refund(
  p_player_id uuid,
  p_season_id uuid,
  p_amount numeric,
  p_refund_date date,
  p_method text,
  p_reference text,
  p_submission_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_program_id uuid;
  v_balance numeric;
  v_existing public.ledger_entries%rowtype;
  v_refund_id uuid;
begin
  if p_submission_id is null then raise exception 'Submission ID is required'; end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Refund amount must be positive and have at most two decimal places';
  end if;
  if p_refund_date is null or p_refund_date > (now() at time zone 'America/Toronto')::date then
    raise exception 'Enter an actual refund date that is not in the future';
  end if;
  if p_method is null or p_method not in ('e-transfer', 'cash', 'other') then
    raise exception 'Select a refund method';
  end if;
  if length(coalesce(p_reference, '')) > 300 then
    raise exception 'Transfer reference is too long';
  end if;

  select s.organization_id, s.program_id into v_org_id, v_program_id
  from public.seasons s where s.id = p_season_id;
  if public.can_manage_program_finance(v_program_id) is not true then
    raise exception 'Only an authorized program manager can record this refund';
  end if;

  perform 1 from public.players p
  where p.id = p_player_id and p.organization_id = v_org_id
  for update;
  if not found then raise exception 'Player was not found in this organization'; end if;

  select * into v_existing from public.ledger_entries
  where submission_id = p_submission_id;
  if found then
    if v_existing.type = 'refund_paid' and v_existing.player_id = p_player_id
      and v_existing.season_id = p_season_id and v_existing.amount = p_amount
      and v_existing.refund_date = p_refund_date and v_existing.refund_method = p_method
      and v_existing.refund_reference is not distinct from nullif(btrim(p_reference), '') then
      return v_existing.id;
    end if;
    raise exception 'Submission ID is already used for another transaction';
  end if;

  select ps.credit_amount into v_balance
  from public.player_season_payment_summary ps
  where ps.player_id = p_player_id and ps.season_id = p_season_id;
  if coalesce(v_balance, 0) < p_amount then
    raise exception 'Refund exceeds current season credit of %', coalesce(v_balance, 0);
  end if;

  insert into public.ledger_entries (
    organization_id, program_id, season_id, player_id, type, amount,
    sessions_count, refund_date, refund_method, refund_reference,
    submission_id, description, created_by
  ) values (
    v_org_id, v_program_id, p_season_id, p_player_id, 'refund_paid', p_amount,
    0, p_refund_date, p_method, nullif(btrim(p_reference), ''),
    p_submission_id, 'Completed player refund', auth.uid()
  ) returning id into v_refund_id;

  insert into public.audit_logs (
    organization_id, actor_id, action, entity_type, entity_id, new_data
  ) values (
    v_org_id, auth.uid(), 'player_refund_recorded', 'ledger_entries', v_refund_id,
    jsonb_build_object('player_id', p_player_id, 'season_id', p_season_id,
      'amount', p_amount, 'refund_date', p_refund_date, 'method', p_method,
      'reference', nullif(btrim(p_reference), ''))
  );
  return v_refund_id;
end;
$$;

create or replace function public.carry_forward_player_balance(
  p_player_id uuid, p_source_season_id uuid, p_destination_season_id uuid,
  p_amount numeric, p_transfer_date date, p_note text, p_submission_id uuid,
  p_transfer_kind text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_source public.seasons%rowtype;
  v_destination public.seasons%rowtype;
  v_existing public.ledger_entries%rowtype;
  v_balance numeric;
  v_out_type text;
  v_in_type text;
  v_transfer_id uuid := gen_random_uuid();
  v_out_id uuid;
  v_in_id uuid;
begin
  if p_transfer_kind is null or p_transfer_kind not in ('credit', 'debt') then
    raise exception 'Choose credit or owing';
  end if;
  v_out_type := case when p_transfer_kind = 'credit' then 'credit_transferred_out' else 'debt_transferred_out' end;
  v_in_type := case when p_transfer_kind = 'credit' then 'credit_transferred_in' else 'debt_transferred_in' end;
  if p_submission_id is null then raise exception 'Submission ID is required'; end if;
  if p_source_season_id is null or p_destination_season_id is null or p_source_season_id = p_destination_season_id then
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
    or v_source.program_id is null or v_source.program_id is distinct from v_destination.program_id then
    raise exception 'Both seasons must belong to the same program and organization';
  end if;
  if public.can_manage_program_finance(v_source.program_id) is not true then
    raise exception 'Only an authorized program manager can carry balances forward';
  end if;
  perform 1 from public.players where id = p_player_id and organization_id = v_source.organization_id for update;
  if not found then raise exception 'Player was not found in this organization'; end if;
  select * into v_existing from public.ledger_entries where submission_id = p_submission_id;
  if found then
    if v_existing.type = v_out_type and v_existing.player_id = p_player_id
      and v_existing.season_id = p_source_season_id and v_existing.amount = p_amount
      and v_existing.transfer_date = p_transfer_date
      and v_existing.transfer_note is not distinct from nullif(btrim(p_note), '')
      and exists (select 1 from public.ledger_entries incoming
        where incoming.transfer_id = v_existing.transfer_id and incoming.type = v_in_type
          and incoming.player_id = p_player_id and incoming.season_id = p_destination_season_id
          and incoming.amount = p_amount) then
      return v_existing.transfer_id;
    end if;
    raise exception 'Submission ID is already used for another transaction';
  end if;
  select case when p_transfer_kind = 'credit' then credit_amount else owes_money end into v_balance
  from public.player_season_payment_summary where player_id = p_player_id and season_id = p_source_season_id;
  if coalesce(v_balance, 0) < p_amount then
    raise exception 'Transfer exceeds current source-season % of %',
      case when p_transfer_kind = 'credit' then 'credit' else 'amount owing' end, coalesce(v_balance, 0);
  end if;
  insert into public.ledger_entries (
    organization_id, program_id, season_id, player_id, type, amount, sessions_count,
    transfer_id, transfer_date, transfer_note, submission_id, description, created_by
  ) values (
    v_source.organization_id, v_source.program_id, v_source.id, p_player_id, v_out_type, p_amount, 0,
    v_transfer_id, p_transfer_date, nullif(btrim(p_note), ''), p_submission_id,
    case when p_transfer_kind = 'credit' then 'Credit' else 'Amount owing' end || ' carried forward to ' || v_destination.name, auth.uid()
  ) returning id into v_out_id;
  insert into public.ledger_entries (
    organization_id, program_id, season_id, player_id, type, amount, sessions_count,
    transfer_id, transfer_date, transfer_note, description, created_by
  ) values (
    v_destination.organization_id, v_destination.program_id, v_destination.id, p_player_id, v_in_type, p_amount, 0,
    v_transfer_id, p_transfer_date, nullif(btrim(p_note), ''),
    case when p_transfer_kind = 'credit' then 'Credit' else 'Amount owing' end || ' carried forward from ' || v_source.name, auth.uid()
  ) returning id into v_in_id;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, new_data)
  values (v_source.organization_id, auth.uid(),
    case when p_transfer_kind = 'credit' then 'player_credit_carried_forward' else 'player_debt_carried_forward' end,
    'ledger_entries', v_out_id,
    jsonb_build_object('transfer_id', v_transfer_id, 'transfer_kind', p_transfer_kind,
      'out_entry_id', v_out_id, 'in_entry_id', v_in_id, 'player_id', p_player_id,
      'source_season_id', v_source.id, 'destination_season_id', v_destination.id,
      'amount', p_amount, 'transfer_date', p_transfer_date, 'note', nullif(btrim(p_note), '')));
  return v_transfer_id;
end;
$$;

create or replace function public.assign_club_expense_season(p_expense_id uuid, p_season_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_expense public.club_expenses%rowtype; v_season public.seasons%rowtype; v_session_season_id uuid;
begin
  select * into v_expense from public.club_expenses where id = p_expense_id for update;
  select * into v_season from public.seasons where id = p_season_id;
  if v_expense.id is null or v_season.id is null or v_expense.season_id is not null
    or v_expense.organization_id is distinct from v_season.organization_id
    or (v_expense.program_id is not null and v_expense.program_id is distinct from v_season.program_id) then
    raise exception 'Unallocated expense and matching season are required';
  end if;
  if public.can_manage_program_finance(v_season.program_id, 'expenses') is not true then
    raise exception 'Only an authorized program manager can assign expenses';
  end if;
  if v_expense.session_id is not null then
    select season_id into v_session_season_id from public.sessions where id = v_expense.session_id;
    if v_session_season_id is distinct from v_season.id then
      raise exception 'Season must match the expense session';
    end if;
  end if;
  update public.club_expenses set season_id = v_season.id, program_id = v_season.program_id where id = v_expense.id;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, old_data, new_data)
  values (v_expense.organization_id, auth.uid(), 'expense_season_assigned', 'club_expenses', v_expense.id,
    jsonb_build_object('season_id', v_expense.season_id, 'program_id', v_expense.program_id),
    jsonb_build_object('season_id', v_season.id, 'program_id', v_season.program_id));
  return v_expense.id;
end;
$$;

create or replace function public.admin_dashboard_season_finance(p_season_id uuid)
returns table(
  signup_collected numeric, drop_in_collected numeric, total_collected numeric,
  total_expenses numeric, total_refunded numeric, club_balance numeric,
  total_player_credit numeric, total_waived numeric, net_club_balance numeric,
  player_count bigint
)
language plpgsql stable security definer set search_path = public as $$
declare v_season public.seasons%rowtype;
begin
  select * into v_season from public.seasons where id = p_season_id;
  if public.can_manage_program_finance(v_season.program_id) is not true then
    raise exception 'Only an authorized program manager can view season finances';
  end if;
  return query
  with paid as (
    select coalesce(sum(p.amount) filter (where p.session_id is null), 0)::numeric signup,
      coalesce(sum(p.amount) filter (where p.session_id is not null), 0)::numeric drop_in
    from public.payments p
    where p.season_id = v_season.id and p.organization_id = v_season.organization_id and p.amount > 0
  ), spent as (
    select coalesce(sum(e.amount), 0)::numeric expenses from public.club_expenses e
    where e.organization_id = v_season.organization_id
      and (e.season_id = v_season.id or (e.season_id is null
        and (v_season.program_id is null or e.program_id = v_season.program_id)))
  ), refunded as (
    select coalesce(sum(le.amount), 0)::numeric refunds from public.ledger_entries le
    where le.season_id = v_season.id and le.organization_id = v_season.organization_id and le.type = 'refund_paid'
  ), credits as (
    select coalesce(sum(greatest(coalesce(ps.credit_amount, 0), 0)), 0)::numeric credit,
      coalesce(sum(ps.waived_amount), 0)::numeric waived
    from public.player_season_payment_summary ps where ps.season_id = v_season.id
  ), transfers as (
    select coalesce((select sum(t.amount) from public.club_balance_transfers t
      where t.destination_season_id = v_season.id), 0)::numeric incoming,
      coalesce((select sum(t.amount) from public.club_balance_transfers t
      where t.source_season_id = v_season.id), 0)::numeric outgoing
  ), participants as (
    select a.player_id from public.attendance a join public.sessions s on s.id = a.session_id where s.season_id = v_season.id
    union select p.player_id from public.payments p where p.season_id = v_season.id
    union select le.player_id from public.ledger_entries le where le.season_id = v_season.id
  ), players as (
    select count(*) count from participants x join public.players p on p.id = x.player_id
    where p.organization_id = v_season.organization_id and p.status = 'active'
  )
  select round(paid.signup, 2), round(paid.drop_in, 2), round(paid.signup + paid.drop_in, 2),
    round(spent.expenses, 2), round(refunded.refunds, 2),
    round(paid.signup + paid.drop_in - spent.expenses - refunded.refunds + transfers.incoming - transfers.outgoing, 2),
    round(credits.credit, 2), round(credits.waived, 2),
    round(paid.signup + paid.drop_in - spent.expenses - refunded.refunds - credits.credit
      + transfers.incoming - transfers.outgoing, 2), players.count
  from paid cross join spent cross join refunded cross join credits cross join transfers cross join players;
end;
$$;

create or replace function public.record_club_balance_transfer(
  p_source_season_id uuid, p_destination_season_id uuid, p_amount numeric,
  p_transfer_date date, p_note text, p_submission_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_source public.seasons%rowtype;
  v_destination public.seasons%rowtype;
  v_available numeric;
  v_existing public.club_balance_transfers%rowtype;
  v_id uuid;
begin
  if p_submission_id is null then raise exception 'Submission ID is required'; end if;
  if p_amount is null or p_amount = 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Enter a nonzero amount with at most two decimal places';
  end if;
  if p_transfer_date is null or p_transfer_date > (now() at time zone 'America/Toronto')::date then
    raise exception 'Transfer date cannot be in the future';
  end if;
  if length(coalesce(p_note, '')) > 300 then raise exception 'Transfer note is too long'; end if;
  if p_source_season_id is null or p_destination_season_id is null
    or p_source_season_id = p_destination_season_id then raise exception 'Choose two different seasons'; end if;
  -- The source row serializes concurrent transfers from this season.
  select * into v_source from public.seasons where id = p_source_season_id for update;
  select * into v_destination from public.seasons where id = p_destination_season_id;
  if v_source.id is null or v_destination.id is null or v_source.organization_id is distinct from v_destination.organization_id
    or v_source.program_id is null or v_source.program_id is distinct from v_destination.program_id
    or v_source.start_date is null or v_destination.start_date is null
    or v_destination.start_date <= v_source.start_date then
    raise exception 'Destination must be a later season in the same program and organization, with both start dates set';
  end if;
  if public.can_manage_program_finance(v_source.program_id) is not true then
    raise exception 'Only an authorized program manager can transfer club balances';
  end if;
  select * into v_existing from public.club_balance_transfers where submission_id = p_submission_id;
  if found then
    if v_existing.reverses_transfer_id is null and v_existing.source_season_id = p_source_season_id
      and v_existing.destination_season_id = p_destination_season_id and v_existing.amount = p_amount
      and v_existing.transfer_date = p_transfer_date
      and v_existing.note is not distinct from nullif(btrim(p_note), '') then return v_existing.id; end if;
    raise exception 'Submission ID is already used';
  end if;
  if exists (select 1 from public.club_expenses e where e.organization_id = v_source.organization_id
    and e.program_id = v_source.program_id and e.season_id is null) then
    raise exception 'Assign all unallocated program expenses to a season before transferring club balance';
  end if;
  select net_club_balance into v_available from public.admin_dashboard_season_finance(p_source_season_id);
  if v_available is null or sign(v_available) <> sign(p_amount) or abs(p_amount) > abs(v_available) then
    raise exception 'Transfer exceeds the current signed Net Club Balance of %', coalesce(v_available, 0);
  end if;
  insert into public.club_balance_transfers (
    organization_id, program_id, source_season_id, destination_season_id, amount,
    transfer_date, note, submission_id, created_by
  ) values (
    v_source.organization_id, v_source.program_id, v_source.id, v_destination.id, p_amount,
    p_transfer_date, nullif(btrim(p_note), ''), p_submission_id, auth.uid()
  ) returning id into v_id;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, new_data)
  values (v_source.organization_id, auth.uid(), 'club_balance_transferred', 'club_balance_transfers', v_id,
    jsonb_build_object('source_season_id', v_source.id, 'destination_season_id', v_destination.id,
      'amount', p_amount, 'transfer_date', p_transfer_date, 'note', nullif(btrim(p_note), '')));
  return v_id;
end;
$$;

create or replace function public.reverse_club_balance_transfer(p_transfer_id uuid, p_submission_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_original public.club_balance_transfers%rowtype; v_existing public.club_balance_transfers%rowtype; v_id uuid;
begin
  if p_submission_id is null then raise exception 'Submission ID is required'; end if;
  select * into v_original from public.club_balance_transfers where id = p_transfer_id and reverses_transfer_id is null;
  if v_original.id is null then raise exception 'Original transfer not found'; end if;
  perform 1 from public.seasons where id = v_original.source_season_id for update;
  if public.can_manage_program_finance(v_original.program_id) is not true then
    raise exception 'Only an authorized program manager can reverse club transfers';
  end if;
  select * into v_existing from public.club_balance_transfers where submission_id = p_submission_id;
  if found then
    if v_existing.reverses_transfer_id = v_original.id then return v_existing.id; end if;
    raise exception 'Submission ID is already used';
  end if;
  if exists (select 1 from public.club_balance_transfers where reverses_transfer_id = v_original.id) then
    raise exception 'Transfer was already reversed';
  end if;
  insert into public.club_balance_transfers (
    organization_id, program_id, source_season_id, destination_season_id, amount,
    transfer_date, note, submission_id, reverses_transfer_id, created_by
  ) values (
    v_original.organization_id, v_original.program_id, v_original.source_season_id,
    v_original.destination_season_id, -v_original.amount,
    (now() at time zone 'America/Toronto')::date, 'Reversal of transfer ' || v_original.id,
    p_submission_id, v_original.id, auth.uid()
  ) returning id into v_id;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, new_data)
  values (v_original.organization_id, auth.uid(), 'club_balance_transfer_reversed', 'club_balance_transfers', v_id,
    jsonb_build_object('reverses_transfer_id', v_original.id, 'amount', -v_original.amount));
  return v_id;
end;
$$;

create or replace function public.transfer_player_credit(
  p_funding_player_id uuid, p_recipient_player_id uuid, p_season_id uuid,
  p_amount numeric, p_transfer_date date, p_session_id uuid, p_note text, p_submission_id uuid
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_season public.seasons%rowtype;
  v_session public.sessions%rowtype;
  v_existing public.ledger_entries%rowtype;
  v_credit numeric;
  v_count integer;
  v_transfer_id uuid := gen_random_uuid();
  v_out_id uuid;
  v_in_id uuid;
  v_funding_name text;
  v_recipient_name text;
begin
  select * into v_season from public.seasons where id = p_season_id;
  if public.can_manage_program_finance(v_season.program_id) is not true then
    raise exception 'Only an authorized program manager can transfer player credit';
  end if;
  if v_season.program_id is null then raise exception 'Select a season belonging to a program'; end if;
  if p_submission_id is null then raise exception 'Submission ID is required'; end if;
  if p_funding_player_id is null or p_recipient_player_id is null or p_funding_player_id = p_recipient_player_id then
    raise exception 'Choose two different players';
  end if;
  if p_amount is null or p_amount::text in ('NaN', 'Infinity', '-Infinity')
    or p_amount <= 0 or p_amount > 99999999.99 or p_amount <> round(p_amount, 2) then
    raise exception 'Transfer amount must be positive and have at most two decimal places';
  end if;
  if p_transfer_date is null or p_transfer_date > (now() at time zone 'America/Toronto')::date then
    raise exception 'Enter a transfer date that is not in the future';
  end if;
  if length(coalesce(p_note, '')) > 300 then raise exception 'Transfer note is too long'; end if;
  if p_session_id is not null then
    select * into v_session from public.sessions where id = p_session_id;
    if v_session.id is null or v_session.season_id is distinct from v_season.id
      or v_session.organization_id is distinct from v_season.organization_id
      or v_session.program_id is distinct from v_season.program_id then
      raise exception 'Session must belong to the selected season and program';
    end if;
  end if;

  -- Match refund/carry-forward player locks; consistent ordering avoids opposing-transfer deadlocks.
  perform id from public.players
    where id in (p_funding_player_id, p_recipient_player_id)
      and organization_id = v_season.organization_id
    order by id for update;
  get diagnostics v_count = row_count;
  if v_count <> 2 then raise exception 'Both players must belong to this organization'; end if;

  select * into v_existing from public.ledger_entries where submission_id = p_submission_id;
  if found then
    if v_existing.type = 'credit_transferred_out'
      and v_existing.player_id = p_funding_player_id
      and v_existing.related_player_id = p_recipient_player_id
      and v_existing.season_id = p_season_id and v_existing.amount = p_amount
      and v_existing.session_id is not distinct from p_session_id
      and v_existing.transfer_date = p_transfer_date
      and v_existing.transfer_note is not distinct from nullif(btrim(p_note), '')
      and exists (select 1 from public.ledger_entries incoming
        where incoming.transfer_id = v_existing.transfer_id and incoming.type = 'credit_transferred_in'
          and incoming.player_id = p_recipient_player_id and incoming.related_player_id = p_funding_player_id
          and incoming.season_id = p_season_id and incoming.amount = p_amount) then
      return v_existing.transfer_id;
    end if;
    raise exception 'Submission ID is already used for another transaction';
  end if;

  select credit_amount into v_credit from public.player_season_payment_summary
    where player_id = p_funding_player_id and season_id = p_season_id;
  if coalesce(v_credit, 0) < p_amount then
    raise exception 'Transfer exceeds current season credit of %', coalesce(v_credit, 0);
  end if;
  select display_name into v_funding_name from public.players where id = p_funding_player_id;
  select display_name into v_recipient_name from public.players where id = p_recipient_player_id;
  insert into public.ledger_entries (
    organization_id, program_id, season_id, session_id, player_id, related_player_id,
    type, amount, sessions_count, transfer_id, transfer_date, transfer_note, submission_id, description, created_by
  ) values (
    v_season.organization_id, v_season.program_id, p_season_id, p_session_id, p_funding_player_id, p_recipient_player_id,
    'credit_transferred_out', p_amount, 0, v_transfer_id, p_transfer_date, nullif(btrim(p_note), ''), p_submission_id,
    'Credit sent to ' || v_recipient_name, auth.uid()
  ) returning id into v_out_id;
  insert into public.ledger_entries (
    organization_id, program_id, season_id, session_id, player_id, related_player_id,
    type, amount, sessions_count, transfer_id, transfer_date, transfer_note, description, created_by
  ) values (
    v_season.organization_id, v_season.program_id, p_season_id, p_session_id, p_recipient_player_id, p_funding_player_id,
    'credit_transferred_in', p_amount, 0, v_transfer_id, p_transfer_date, nullif(btrim(p_note), ''),
    'Credit received from ' || v_funding_name, auth.uid()
  ) returning id into v_in_id;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, new_data)
  values (v_season.organization_id, auth.uid(), 'player_credit_transferred', 'ledger_entries', v_out_id,
    jsonb_build_object('transfer_id', v_transfer_id, 'out_entry_id', v_out_id, 'in_entry_id', v_in_id,
      'funding_player_id', p_funding_player_id, 'recipient_player_id', p_recipient_player_id,
      'season_id', p_season_id, 'session_id', p_session_id, 'amount', p_amount,
      'transfer_date', p_transfer_date, 'note', nullif(btrim(p_note), '')));
  return v_transfer_id;
end;
$$;

drop policy if exists "club_balance_transfers_admin_read" on public.club_balance_transfers;
create policy "club_balance_transfers_program_read" on public.club_balance_transfers
for select to authenticated using (public.can_manage_program_finance(program_id));
create trigger validate_organization_program_scope before insert or update on public.club_balance_transfers
for each row execute function public.validate_organization_program_scope();
create trigger prevent_disabled_program_writes before insert or update or delete on public.club_balance_transfers
for each row execute function public.prevent_disabled_program_writes('payments');

-- Restrictive scope policies also constrain older, permissive organization policies.
create or replace function public.can_access_program(p_program_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth.uid() is not null and o.onboarding_status = 'active' and (
    public.has_platform_organization_access(o.id) or exists (
      select 1 from public.organization_members om
      where om.organization_id = o.id and om.profile_id = auth.uid() and om.status = 'active'
        and (om.role in ('owner', 'admin') or exists (
          select 1 from public.program_members pm where pm.program_id = p.id
            and pm.profile_id = auth.uid() and pm.status = 'active'
        ))
    )
  ), false)
  from public.programs p join public.organizations o on o.id = p.organization_id
  where p.id = p_program_id;
$$;
revoke all on function public.can_access_program(uuid) from public, anon;
grant execute on function public.can_access_program(uuid) to authenticated;

-- Guests may have payments/credit before they have a program-membership record.
create policy integrated_finance_player_directory on public.players for select to authenticated
using (exists (select 1 from public.programs p
  where p.organization_id = players.organization_id and public.can_manage_program_finance(p.id)));

do $$
declare table_name text;
begin
  foreach table_name in array array['seasons','sessions','payments','ledger_entries','session_player_charges',
    'attendance','dropouts','session_teams','session_team_players','session_matches','goals','club_expenses',
    'leagues','league_teams','league_team_players','league_matches','player_performance_ratings','club_balance_transfers'] loop
    execute format('create policy integrated_program_scope on public.%I as restrictive for all to authenticated
      using (public.can_access_program(program_id) or (program_id is null and public.organization_role(organization_id) = ''admin''))
      with check (public.can_access_program(program_id) or (program_id is null and public.organization_role(organization_id) = ''admin''))', table_name);
  end loop;
  foreach table_name in array array['payments','ledger_entries','session_player_charges','club_expenses'] loop
    execute format('create policy integrated_finance_manager on public.%I for all to authenticated
      using (public.can_manage_program_finance(program_id, %L))
      with check (public.can_manage_program_finance(program_id, %L))', table_name,
      case when table_name = 'club_expenses' then 'expenses' else 'payments' end,
      case when table_name = 'club_expenses' then 'expenses' else 'payments' end);
  end loop;
end;
$$;
