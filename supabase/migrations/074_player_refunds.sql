alter table public.ledger_entries
  add column if not exists refund_date date,
  add column if not exists refund_method text,
  add column if not exists refund_reference text,
  add column if not exists submission_id uuid;

create unique index if not exists ledger_entries_submission_id_key
  on public.ledger_entries(submission_id)
  where submission_id is not null;

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
      when type in ('credit_added', 'credit_transferred_in') then coalesce(amount, 0)
      when type in ('credit_transferred_out', 'refund_paid') then -coalesce(amount, 0)
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

-- Preserve the existing public report columns and statistics; use the same
-- season balance as the admin report for the three financial columns.
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
      or coalesce(u.total_played_sessions, 0) > 0
      or coalesce(u.confirmed_sessions, 0) > 0
      or coalesce(u.estimated_used_amount, 0) > 0
      or coalesce(sc.goals, 0) > 0
      or coalesce(ast.assists, 0) > 0
      or cs.latest_session is not null
      or ups.upcoming_session is not null)
  order by s.start_date desc nulls last, s.name, p.display_name;
$$;

create or replace view public.player_available_credit_summary
with (security_invoker = true) as
with season_balances as (
  select s.organization_id, s.program_id, ps.player_id,
    sum(ps.total_paid_amount)::numeric payment_amount,
    sum(ps.estimated_used_amount)::numeric consumed_amount,
    sum(ps.credit_amount - ps.owes_money - ps.total_paid_amount + ps.estimated_used_amount)::numeric adjustment_amount,
    sum(ps.credit_amount - ps.owes_money)::numeric balance_amount,
    sum(ps.credit_amount)::numeric available_credit_amount
  from public.player_season_payment_summary ps
  join public.seasons s on s.id = ps.season_id
  group by s.organization_id, s.program_id, ps.player_id
)
select sb.organization_id, sb.program_id, sb.player_id,
  p.display_name player_name, p.status player_status,
  round(sb.payment_amount, 2) payment_amount,
  round(sb.consumed_amount, 2) consumed_amount,
  round(sb.adjustment_amount, 2) adjustment_amount,
  round(sb.balance_amount, 2) balance_amount,
  round(sb.available_credit_amount, 2) available_credit_amount
from season_balances sb
join public.players p on p.id = sb.player_id;

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
  if v_org_id is null or public.organization_role(v_org_id) is distinct from 'admin' then
    raise exception 'Only an organization admin can record this refund';
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

revoke all on function public.record_player_refund(uuid, uuid, numeric, date, text, text, uuid) from public, anon;
grant execute on function public.record_player_refund(uuid, uuid, numeric, date, text, text, uuid) to authenticated;
