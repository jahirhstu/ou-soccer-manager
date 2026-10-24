create table public.club_balance_transfers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  program_id uuid not null references public.programs(id),
  source_season_id uuid not null references public.seasons(id),
  destination_season_id uuid not null references public.seasons(id),
  amount numeric(12,2) not null check (amount <> 0),
  transfer_date date not null,
  note text check (length(note) <= 300),
  submission_id uuid not null unique,
  reverses_transfer_id uuid unique references public.club_balance_transfers(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (source_season_id <> destination_season_id)
);

create index club_balance_transfers_source_idx on public.club_balance_transfers(source_season_id);
create index club_balance_transfers_destination_idx on public.club_balance_transfers(destination_season_id);

alter table public.club_balance_transfers enable row level security;
create policy "club_balance_transfers_admin_read" on public.club_balance_transfers
  for select to authenticated using (public.organization_role(organization_id) = 'admin');
revoke all on public.club_balance_transfers from public, anon;
grant select on public.club_balance_transfers to authenticated;

-- Keep existing unassigned expenses until an admin allocates them, but reject new ones.
alter table public.club_expenses add constraint club_expenses_season_required
  check (season_id is not null) not valid;

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
  if public.organization_role(v_expense.organization_id) is distinct from 'admin' then
    raise exception 'Only an organization admin can assign expenses';
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
  if v_season.id is null or public.organization_role(v_season.organization_id) is distinct from 'admin' then
    raise exception 'Only an organization admin can view season finances';
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
  if public.organization_role(v_source.organization_id) is distinct from 'admin' then
    raise exception 'Only an organization admin can transfer club balances';
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

create or replace function public.admin_club_transfer_summary(p_season_id uuid)
returns table(season_result numeric, carried_in numeric, carried_out numeric, balance_remaining numeric)
language sql stable security definer set search_path = public as $$
  with transfer_totals as (
    select coalesce((select sum(amount) from public.club_balance_transfers
      where destination_season_id = p_season_id), 0)::numeric incoming,
      coalesce((select sum(amount) from public.club_balance_transfers
      where source_season_id = p_season_id), 0)::numeric outgoing
  ), finance as (
    select net_club_balance from public.admin_dashboard_season_finance(p_season_id)
  )
  select round(finance.net_club_balance - t.incoming + t.outgoing, 2),
    round(t.incoming, 2), round(t.outgoing, 2), round(finance.net_club_balance, 2)
  from finance cross join transfer_totals t;
$$;

create or replace function public.reverse_club_balance_transfer(p_transfer_id uuid, p_submission_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_original public.club_balance_transfers%rowtype; v_existing public.club_balance_transfers%rowtype; v_id uuid;
begin
  if p_submission_id is null then raise exception 'Submission ID is required'; end if;
  select * into v_original from public.club_balance_transfers where id = p_transfer_id and reverses_transfer_id is null;
  if v_original.id is null then raise exception 'Original transfer not found'; end if;
  perform 1 from public.seasons where id = v_original.source_season_id for update;
  if public.organization_role(v_original.organization_id) is distinct from 'admin' then
    raise exception 'Only an organization admin can reverse club transfers';
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

revoke all on function public.record_club_balance_transfer(uuid, uuid, numeric, date, text, uuid) from public, anon;
revoke all on function public.reverse_club_balance_transfer(uuid, uuid) from public, anon;
revoke all on function public.admin_club_transfer_summary(uuid) from public, anon;
revoke all on function public.assign_club_expense_season(uuid, uuid) from public, anon;
grant execute on function public.record_club_balance_transfer(uuid, uuid, numeric, date, text, uuid) to authenticated;
grant execute on function public.reverse_club_balance_transfer(uuid, uuid) to authenticated;
grant execute on function public.admin_club_transfer_summary(uuid) to authenticated;
grant execute on function public.assign_club_expense_season(uuid, uuid) to authenticated;
