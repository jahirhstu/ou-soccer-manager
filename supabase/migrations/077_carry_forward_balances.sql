-- Debt transfers store positive amounts; their direction controls the sign.
alter table public.ledger_entries drop constraint if exists ledger_entries_type_check;
alter table public.ledger_entries add constraint ledger_entries_type_check check (
  type in ('payment_received', 'session_used', 'fee_waived', 'credit_added',
    'credit_transferred_out', 'credit_transferred_in', 'debt_transferred_out',
    'debt_transferred_in', 'refund_due', 'refund_paid', 'manual_adjustment')
);
alter table public.ledger_entries add constraint ledger_debt_transfer_amount_positive
  check (type not in ('debt_transferred_out', 'debt_transferred_in') or (amount is not null and amount > 0));

create or replace view public.player_season_transfer_summary
with (security_invoker = true) as
select organization_id, player_id, season_id,
  coalesce(sum(amount) filter (where type = 'credit_transferred_in'), 0)::numeric transfer_in_amount,
  coalesce(sum(amount) filter (where type = 'credit_transferred_out'), 0)::numeric transfer_out_amount,
  coalesce(sum(amount) filter (where type = 'debt_transferred_in'), 0)::numeric debt_transfer_in_amount,
  coalesce(sum(amount) filter (where type = 'debt_transferred_out'), 0)::numeric debt_transfer_out_amount
from public.ledger_entries
where transfer_id is not null
  and type in ('credit_transferred_in', 'credit_transferred_out', 'debt_transferred_in', 'debt_transferred_out')
group by organization_id, player_id, season_id;

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
  if public.organization_role(v_source.organization_id) is distinct from 'admin' then
    raise exception 'Only an organization admin can carry balances forward';
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

create or replace function public.carry_forward_player_credit(
  p_player_id uuid, p_source_season_id uuid, p_destination_season_id uuid,
  p_amount numeric, p_transfer_date date, p_note text, p_submission_id uuid
)
returns uuid language sql security definer set search_path = public as $$
  select public.carry_forward_player_balance(p_player_id, p_source_season_id, p_destination_season_id,
    p_amount, p_transfer_date, p_note, p_submission_id, 'credit');
$$;

revoke all on function public.carry_forward_player_balance(uuid, uuid, uuid, numeric, date, text, uuid, text) from public, anon;
grant execute on function public.carry_forward_player_balance(uuid, uuid, uuid, numeric, date, text, uuid, text) to authenticated;
revoke all on function public.carry_forward_player_credit(uuid, uuid, uuid, numeric, date, text, uuid) from public, anon;
grant execute on function public.carry_forward_player_credit(uuid, uuid, uuid, numeric, date, text, uuid) to authenticated;

create or replace view public.player_season_payment_summary
with (security_invoker = true) as
with payment_totals as (
  select player_id, season_id,
    coalesce(sum(amount), 0) total_paid_amount,
    coalesce(sum(sessions_covered), 0) total_paid_sessions
  from public.payments
  group by player_id, season_id
),
usage as (
  select a.player_id, s.season_id,
    count(*) filter (
      where a.status in ('played', 'replacement')
        or (a.status = 'confirmed' and (s.status = 'completed' or s.session_date < (now() at time zone 'America/Toronto')::date))
    )::numeric total_played_sessions,
    coalesce(sum(case
      when a.status in ('played', 'replacement')
        or (a.status = 'confirmed' and (s.status = 'completed' or s.session_date < (now() at time zone 'America/Toronto')::date))
        then coalesce(spc.amount, s.price_per_session, seasons.price_per_session)
      when a.status in ('confirmed', 'played', 'replacement') and spc.id is not null
        then spc.amount
      else 0 end), 0) estimated_used_amount,
    coalesce(sum(case
      when a.status in ('played', 'replacement')
        or (a.status = 'confirmed' and (s.status = 'completed' or s.session_date < (now() at time zone 'America/Toronto')::date))
        or (a.status = 'confirmed' and spc.id is not null)
        then coalesce(spc.waiver_amount, 0)
      else 0 end), 0) waived_amount
  from public.attendance a
  join public.sessions s on s.id = a.session_id
  join public.seasons seasons on seasons.id = s.season_id
  left join public.session_player_charges spc
    on spc.session_id = a.session_id and spc.player_id = a.player_id
  group by a.player_id, s.season_id
),
ledger_totals as (
  select player_id, season_id,
    greatest(
      coalesce(sum(amount) filter (where type = 'refund_due'), 0)
        - coalesce(sum(amount) filter (where type = 'refund_paid'), 0),
      0
    ) refund_due_amount,
    coalesce(sum(amount) filter (where type = 'refund_paid'), 0) refund_paid_amount,
    coalesce(sum(case
      when type in ('credit_added', 'credit_transferred_in', 'debt_transferred_out') then coalesce(amount, 0)
      when type in ('credit_transferred_out', 'refund_paid', 'debt_transferred_in') then -coalesce(amount, 0)
      when type = 'manual_adjustment' then coalesce(amount, 0)
      else 0 end), 0) adjustment_amount
  from public.ledger_entries
  group by player_id, season_id
)
select
  p.id player_id,
  p.display_name player_name,
  s.id season_id,
  s.name season_name,
  coalesce(pt.total_paid_amount, 0) total_paid_amount,
  coalesce(pt.total_paid_sessions, 0) total_paid_sessions,
  coalesce(u.total_played_sessions, 0) total_played_sessions,
  greatest(coalesce(pt.total_paid_sessions, 0) - coalesce(u.total_played_sessions, 0), 0) remaining_sessions,
  coalesce(u.estimated_used_amount, 0) estimated_used_amount,
  greatest(coalesce(pt.total_paid_amount, 0) - coalesce(u.estimated_used_amount, 0) + coalesce(lt.adjustment_amount, 0), 0) credit_amount,
  coalesce(lt.refund_due_amount, 0) refund_due_amount,
  greatest(coalesce(u.estimated_used_amount, 0) - coalesce(pt.total_paid_amount, 0) - coalesce(lt.adjustment_amount, 0), 0) owes_money,
  coalesce(u.waived_amount, 0) waived_amount,
  coalesce(lt.refund_paid_amount, 0) refund_paid_amount
from public.players p
cross join public.seasons s
left join payment_totals pt on pt.player_id = p.id and pt.season_id = s.id
left join usage u on u.player_id = p.id and u.season_id = s.id
left join ledger_totals lt on lt.player_id = p.id and lt.season_id = s.id
where p.organization_id = s.organization_id;

create or replace function public.public_player_report()
returns table(
  player_id uuid, player_name text, season_id uuid, season_name text,
  total_paid_amount numeric, total_played_sessions numeric,
  confirmed_sessions numeric, estimated_used_amount numeric,
  credit_amount numeric, owes_money numeric, balance_amount numeric,
  goals integer, assists integer, appearances integer,
  last_attended_sessions text[], latest_session text, upcoming_session text
)
language sql stable security definer set search_path = public as $$
  with attendance_usage as (
    select a.player_id, s.season_id,
      count(*) filter (
        where a.status in ('played', 'replacement')
          or (a.status = 'confirmed' and (s.status = 'completed' or s.session_date < (now() at time zone 'America/Toronto')::date))
      )::numeric total_played_sessions,
      count(*) filter (
        where a.status in ('confirmed', 'waitlisted')
          and s.status = 'scheduled'
          and s.session_date >= (now() at time zone 'America/Toronto')::date
      )::numeric confirmed_sessions,
      coalesce(sum(case
        when a.status in ('played', 'replacement')
          or (a.status = 'confirmed' and (s.status = 'completed' or s.session_date < (now() at time zone 'America/Toronto')::date))
          then coalesce(spc.amount, s.price_per_session, seasons.price_per_session)
        when a.status in ('confirmed', 'played', 'replacement') and spc.id is not null
          then spc.amount
        else 0 end), 0) estimated_used_amount
    from public.attendance a
    join public.sessions s on s.id = a.session_id
    join public.seasons seasons on seasons.id = s.season_id
    left join public.session_player_charges spc
      on spc.session_id = a.session_id and spc.player_id = a.player_id
    group by a.player_id, s.season_id
  ),
  scored as (
    select g.scorer_id player_id, s.season_id, coalesce(sum(g.goal_count), 0)::integer goals
    from public.goals g join public.sessions s on s.id = g.session_id
    where coalesce(g.goal_type, 'goal') = 'goal'
    group by g.scorer_id, s.season_id
  ),
  assisted as (
    select g.assist_player_id player_id, s.season_id, count(g.id)::integer assists
    from public.goals g join public.sessions s on s.id = g.session_id
    where g.assist_player_id is not null and coalesce(g.goal_type, 'goal') = 'goal'
    group by g.assist_player_id, s.season_id
  ),
  completed_sessions as (
    select ranked.player_id, ranked.season_id,
      array_agg(ranked.session_label order by ranked.session_date desc, ranked.created_at desc) last_attended_sessions,
      max(ranked.session_label) filter (where ranked.rn = 1) latest_session
    from (
      select a.player_id, s.season_id, s.session_date, s.created_at,
        coalesce(nullif(s.name, ''), s.session_date::text) session_label,
        row_number() over (partition by a.player_id, s.season_id order by s.session_date desc, s.created_at desc) rn
      from public.attendance a join public.sessions s on s.id = a.session_id
      where a.status = 'played'
        or (a.status in ('replacement', 'confirmed')
          and (s.status = 'completed' or s.session_date < (now() at time zone 'America/Toronto')::date))
    ) ranked
    where ranked.rn <= 3
    group by ranked.player_id, ranked.season_id
  ),
  upcoming_sessions as (
    select player_id, season_id, session_label upcoming_session
    from (
      select a.player_id, s.season_id,
        coalesce(nullif(s.name, ''), s.session_date::text) session_label,
        row_number() over (partition by a.player_id, s.season_id order by s.session_date asc, s.created_at asc) rn
      from public.attendance a join public.sessions s on s.id = a.session_id
      where a.status in ('confirmed', 'waitlisted', 'replacement')
        and s.status = 'scheduled'
        and s.session_date >= (now() at time zone 'America/Toronto')::date
    ) ranked where ranked.rn = 1
  )
  select p.id, p.display_name, s.id, s.name,
    coalesce(ps.total_paid_amount, 0),
    coalesce(u.total_played_sessions, 0),
    coalesce(u.confirmed_sessions, 0),
    coalesce(u.estimated_used_amount, 0),
    coalesce(ps.credit_amount, 0),
    coalesce(ps.owes_money, 0),
    coalesce(ps.credit_amount, 0) - coalesce(ps.owes_money, 0),
    coalesce(sc.goals, 0), coalesce(ast.assists, 0),
    coalesce(u.total_played_sessions, 0)::integer,
    coalesce(cs.last_attended_sessions, array[]::text[]),
    cs.latest_session, ups.upcoming_session
  from public.players p
  cross join public.seasons s
  left join public.player_season_payment_summary ps
    on ps.player_id = p.id and ps.season_id = s.id
  left join attendance_usage u on u.player_id = p.id and u.season_id = s.id
  left join scored sc on sc.player_id = p.id and sc.season_id = s.id
  left join assisted ast on ast.player_id = p.id and ast.season_id = s.id
  left join completed_sessions cs on cs.player_id = p.id and cs.season_id = s.id
  left join upcoming_sessions ups on ups.player_id = p.id and ups.season_id = s.id
  where p.status = 'active' and p.organization_id = s.organization_id
    and (coalesce(ps.total_paid_amount, 0) > 0
      or coalesce(ps.credit_amount, 0) > 0
      or coalesce(ps.owes_money, 0) > 0
      or coalesce(u.total_played_sessions, 0) > 0
      or coalesce(u.confirmed_sessions, 0) > 0
      or coalesce(u.estimated_used_amount, 0) > 0
      or coalesce(sc.goals, 0) > 0
      or coalesce(ast.assists, 0) > 0
      or cs.latest_session is not null
      or ups.upcoming_session is not null)
  order by s.start_date desc nulls last, s.name, p.display_name;
$$;
