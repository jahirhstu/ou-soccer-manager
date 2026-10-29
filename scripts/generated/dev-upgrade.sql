-- Development-only upgrade for the inspected pre-merge schema. Run through dev-database.ts.

-- Existing data is preserved. Four legacy extra columns are intentionally retained.

CREATE OR REPLACE FUNCTION public.public_latest_session_winner(p_season_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(session_id uuid, session_name text, session_date date, winning_team_name text, winning_score integer, runner_up_score integer, is_draw boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with latest_session as (
    select
      s.id,
      coalesce(nullif(s.name, ''), s.session_date::text) name,
      s.session_date
    from public.sessions s
    where (p_season_id is null or s.season_id = p_season_id)
      and exists (
        select 1
        from public.session_matches sm
        where sm.session_id = s.id
      )
    order by s.session_date desc, s.created_at desc
    limit 1
  ),
  scored_teams as (
    select
      sm.session_id,
      sm.team_a_id team_id,
      st.name,
      sum(sm.team_a_score)::integer score
    from public.session_matches sm
    join public.session_teams st on st.id = sm.team_a_id
    join latest_session ls on ls.id = sm.session_id
    group by sm.session_id, sm.team_a_id, st.name
    union all
    select
      sm.session_id,
      sm.team_b_id team_id,
      st.name,
      sum(sm.team_b_score)::integer score
    from public.session_matches sm
    join public.session_teams st on st.id = sm.team_b_id
    join latest_session ls on ls.id = sm.session_id
    group by sm.session_id, sm.team_b_id, st.name
  ),
  score_summary as (
    select
      max(score) top_score,
      (
        select max(score)
        from scored_teams
        where score < (select max(score) from scored_teams)
      ) runner_up_score
    from scored_teams
  ),
  winners as (
    select
      scored.session_id,
      string_agg(scored.name, ', ' order by scored.name) names,
      count(*) winner_count
    from scored_teams scored
    cross join score_summary ss
    where scored.score = ss.top_score
    group by scored.session_id
  )
  select
    ls.id session_id,
    ls.name session_name,
    ls.session_date,
    case when w.winner_count > 1 then 'Draw: ' || w.names else w.names end winning_team_name,
    ss.top_score winning_score,
    coalesce(ss.runner_up_score, ss.top_score) runner_up_score,
    w.winner_count > 1 is_draw
  from latest_session ls
  join winners w on w.session_id = ls.id
  cross join score_summary ss;
$function$
;

alter table public.player_aliases add constraint player_aliases_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id);

alter table public.session_player_charges add constraint session_player_charges_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id);

alter table public.session_team_players add constraint session_team_players_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id);

alter table public.session_team_update_events add constraint session_team_update_events_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES profiles(id);

alter table public.session_teams add constraint session_teams_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id);

-- SOURCE: 049_fix_player_season_stats_summary_counts.sql
create or replace view public.player_season_stats_summary
with (security_invoker = true) as
with appearances as (
  select
    a.player_id,
    ss.season_id,
    count(distinct a.session_id) filter (where a.status in ('played','replacement'))::integer appearances
  from public.attendance a
  join public.sessions ss on ss.id = a.session_id
  group by a.player_id, ss.season_id
),
goal_totals as (
  select
    g.scorer_id player_id,
    ss.season_id,
    coalesce(sum(g.goal_count), 0)::integer goals
  from public.goals g
  join public.sessions ss on ss.id = g.session_id
  where g.goal_type = 'goal'
  group by g.scorer_id, ss.season_id
),
assist_totals as (
  select
    g.assist_player_id player_id,
    ss.season_id,
    count(g.id)::integer assists
  from public.goals g
  join public.sessions ss on ss.id = g.session_id
  where g.goal_type = 'goal'
    and g.assist_player_id is not null
  group by g.assist_player_id, ss.season_id
)
select
  p.id player_id,
  p.display_name player_name,
  s.id season_id,
  s.name season_name,
  coalesce(a.appearances, 0)::integer appearances,
  coalesce(gt.goals, 0)::integer goals,
  coalesce(at.assists, 0)::integer assists
from public.players p
cross join public.seasons s
left join appearances a on a.player_id = p.id and a.season_id = s.id
left join goal_totals gt on gt.player_id = p.id and gt.season_id = s.id
left join assist_totals at on at.player_id = p.id and at.season_id = s.id;


-- SOURCE: 068_accept_payment_sent_notifications.sql
alter table public.notifications
  add column if not exists payment_id uuid references public.payments(id) on delete set null,
  add column if not exists ledger_entry_id uuid references public.ledger_entries(id) on delete set null;

create index if not exists notifications_payment_id_idx on public.notifications(payment_id);

create or replace function public.public_payment_notification_keys()
returns table(
  player_id uuid,
  season_id uuid,
  amount numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select n.player_id, n.season_id, n.amount
  from public.notifications n
  where n.notification_type = 'payment_sent'
    and n.read_at is null;
$$;

grant execute on function public.public_payment_notification_keys() to anon, authenticated, service_role;

create or replace function public.submit_payment_sent_notification(p_player_id uuid, p_season_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  report_row record;
  owed_amount numeric(10,2);
  existing_id uuid;
  inserted_id uuid;
  org_id uuid;
  player_name text;
begin
  select *
  into report_row
  from public.public_player_report()
  where public_player_report.player_id = p_player_id
    and public_player_report.season_id = p_season_id
  limit 1;

  if not found then
    return jsonb_build_object('error', 'Player balance was not found.');
  end if;

  owed_amount := round(greatest(-coalesce(report_row.balance_amount, 0), 0)::numeric, 2);
  if owed_amount <= 0 then
    return jsonb_build_object('error', 'This player does not currently owe money.');
  end if;

  select n.id
  into existing_id
  from public.notifications n
  where n.notification_type = 'payment_sent'
    and n.player_id = p_player_id
    and n.season_id = p_season_id
    and n.amount = owed_amount
    and n.read_at is null
  order by n.created_at desc
  limit 1;

  if existing_id is not null then
    return jsonb_build_object('success', true, 'duplicate', true, 'id', existing_id, 'amount', owed_amount);
  end if;

  select coalesce(seasons.organization_id, public.current_organization_id()) into org_id
  from public.seasons
  where seasons.id = p_season_id;

  player_name := coalesce(report_row.player_name, 'Player');

  insert into public.notifications(
    organization_id,
    player_id,
    season_id,
    notification_type,
    amount,
    message
  )
  values (
    org_id,
    p_player_id,
    p_season_id,
    'payment_sent',
    owed_amount,
    player_name || ' sent a payment of $' || owed_amount::text || '.'
  )
  returning id into inserted_id;

  return jsonb_build_object('success', true, 'duplicate', false, 'id', inserted_id, 'amount', owed_amount);
end;
$$;

grant execute on function public.submit_payment_sent_notification(uuid, uuid) to anon, authenticated, service_role;

create or replace function public.accept_notification(p_notification_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  notification_row public.notifications%rowtype;
  season_program_id uuid;
  inserted_payment_id uuid;
  inserted_ledger_entry_id uuid;
  actor_id uuid := auth.uid();
begin
  select *
  into notification_row
  from public.notifications
  where id = p_notification_id
  for update;

  if not found then
    return jsonb_build_object('error', 'Notification was not found.');
  end if;

  if public.organization_role(notification_row.organization_id) is distinct from 'admin' then
    raise exception 'Only admins can update notifications.';
  end if;

  if notification_row.read_at is not null then
    return jsonb_build_object('success', true, 'alreadyRead', true, 'paymentId', notification_row.payment_id);
  end if;

  if notification_row.notification_type = 'payment_sent' and notification_row.payment_id is null then
    select program_id
    into season_program_id
    from public.seasons
    where id = notification_row.season_id;

    insert into public.payments(
      organization_id,
      program_id,
      season_id,
      player_id,
      payment_date,
      amount,
      payment_method,
      reference_note,
      created_by
    )
    values (
      notification_row.organization_id,
      season_program_id,
      notification_row.season_id,
      notification_row.player_id,
      (notification_row.created_at at time zone 'America/Toronto')::date,
      notification_row.amount,
      'e-transfer',
      'Payment sent notification ' || notification_row.id::text,
      actor_id
    )
    returning id into inserted_payment_id;

    insert into public.ledger_entries(
      organization_id,
      program_id,
      season_id,
      player_id,
      type,
      amount,
      description,
      created_by
    )
    values (
      notification_row.organization_id,
      season_program_id,
      notification_row.season_id,
      notification_row.player_id,
      'payment_received',
      notification_row.amount,
      'Payment sent notification ' || notification_row.id::text,
      actor_id
    )
    returning id into inserted_ledger_entry_id;
  end if;

  update public.notifications
  set
    read_at = now(),
    read_by = actor_id,
    payment_id = coalesce(payment_id, inserted_payment_id),
    ledger_entry_id = coalesce(ledger_entry_id, inserted_ledger_entry_id)
  where id = p_notification_id;

  return jsonb_build_object(
    'success', true,
    'alreadyRead', false,
    'paymentId', inserted_payment_id,
    'ledgerEntryId', inserted_ledger_entry_id
  );
end;
$$;

grant execute on function public.accept_notification(uuid) to authenticated, service_role;


-- SOURCE: 070_public_latest_winning_streaks.sql
create or replace function public.public_latest_winning_streaks(p_season_id uuid default null)
returns table(
  player_id uuid,
  player_name text,
  season_id uuid,
  season_name text,
  streak_count integer,
  start_session_date date,
  end_session_date date,
  session_names text[]
)
language sql
stable
security definer
set search_path = public
as $$
  with scored_sessions as (
    select
      s.id session_id,
      s.season_id,
      seasons.name season_name,
      s.session_date,
      s.created_at,
      coalesce(nullif(s.name, ''), s.session_date::text) session_name,
      row_number() over (partition by s.season_id order by s.session_date, s.created_at, s.id) session_order
    from public.sessions s
    join public.seasons on seasons.id = s.season_id
    where (p_season_id is null or s.season_id = p_season_id)
      and exists (
        select 1
        from public.session_matches sm
        where sm.session_id = s.id
          and sm.result_status = 'played'
      )
  ),
  latest_session as (
    select *
    from scored_sessions
    order by session_date desc, created_at desc, session_id desc
    limit 1
  ),
  scored_team_rows as (
    select
      sm.session_id,
      sm.team_a_id team_id,
      sm.team_a_score::integer goals_for,
      sm.team_b_score::integer goals_against,
      case when sm.away_team_id = sm.team_a_id then sm.team_a_score else 0 end::integer away_goals,
      case when sm.team_a_score > sm.team_b_score then 3 when sm.team_a_score = sm.team_b_score then 1 else 0 end::integer points
    from public.session_matches sm
    join scored_sessions ss on ss.session_id = sm.session_id
    where sm.result_status = 'played'
      and sm.team_a_id is not null
      and sm.team_b_id is not null
    union all
    select
      sm.session_id,
      sm.team_b_id team_id,
      sm.team_b_score::integer goals_for,
      sm.team_a_score::integer goals_against,
      case when sm.away_team_id = sm.team_b_id then sm.team_b_score else 0 end::integer away_goals,
      case when sm.team_b_score > sm.team_a_score then 3 when sm.team_b_score = sm.team_a_score then 1 else 0 end::integer points
    from public.session_matches sm
    join scored_sessions ss on ss.session_id = sm.session_id
    where sm.result_status = 'played'
      and sm.team_a_id is not null
      and sm.team_b_id is not null
  ),
  session_team_standings as (
    select
      str.session_id,
      str.team_id,
      sum(str.goals_for)::integer goals_for,
      sum(str.goals_against)::integer goals_against,
      (sum(str.goals_for) - sum(str.goals_against))::integer goal_difference,
      sum(str.away_goals)::integer away_goals,
      sum(str.points)::integer points
    from scored_team_rows str
    where str.team_id is not null
    group by str.session_id, str.team_id
  ),
  session_winners as (
    select session_id, team_id
    from (
      select
        sts.*,
        rank() over (
          partition by sts.session_id
          order by sts.points desc, sts.goal_difference desc, sts.goals_for desc, sts.away_goals desc
        ) winner_rank
      from session_team_standings sts
    ) ranked
    where winner_rank = 1
  ),
  latest_winner_players as (
    select distinct
      p.id player_id,
      p.display_name player_name,
      ls.season_id,
      ls.season_name,
      ls.session_order latest_session_order
    from latest_session ls
    join session_winners sw on sw.session_id = ls.session_id
    join public.session_team_players stp
      on stp.session_id = ls.session_id
      and stp.session_team_id = sw.team_id
    join public.players p on p.id = stp.player_id
  ),
  candidate_sessions as (
    select
      lwp.player_id,
      lwp.player_name,
      lwp.season_id,
      lwp.season_name,
      ss.session_id,
      ss.session_date,
      ss.session_name,
      ss.session_order,
      sw.team_id is not null is_winning_session
    from latest_winner_players lwp
    join scored_sessions ss
      on ss.season_id = lwp.season_id
      and ss.session_order <= lwp.latest_session_order
    left join public.session_team_players stp
      on stp.session_id = ss.session_id
      and stp.player_id = lwp.player_id
    left join session_winners sw
      on sw.session_id = ss.session_id
      and sw.team_id = stp.session_team_id
  ),
  reverse_groups as (
    select
      cs.*,
      count(*) filter (where not cs.is_winning_session) over (
        partition by cs.player_id, cs.season_id
        order by cs.session_order desc
      ) breaks_seen
    from candidate_sessions cs
  ),
  streaks as (
    select
      rg.player_id,
      rg.player_name,
      rg.season_id,
      rg.season_name,
      count(*)::integer streak_count,
      min(rg.session_date) start_session_date,
      max(rg.session_date) end_session_date,
      array_agg(rg.session_name order by rg.session_order) session_names
    from reverse_groups rg
    where rg.breaks_seen = 0
      and rg.is_winning_session
    group by rg.player_id, rg.player_name, rg.season_id, rg.season_name
  ),
  ranked_streaks as (
    select
      streaks.*,
      max(streak_count) over () max_streak_count
    from streaks
  )
  select
    player_id,
    player_name,
    season_id,
    season_name,
    streak_count,
    start_session_date,
    end_session_date,
    session_names
  from ranked_streaks
  where streak_count = max_streak_count
  order by player_name;
$$;

grant execute on function public.public_latest_winning_streaks(uuid) to anon, authenticated, service_role;


-- SOURCE: 071_notification_payments_session_link.sql
create or replace function public.accept_notification(p_notification_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  notification_row public.notifications%rowtype;
  season_program_id uuid;
  latest_session_id uuid;
  inserted_payment_id uuid;
  inserted_ledger_entry_id uuid;
  actor_id uuid := auth.uid();
begin
  select *
  into notification_row
  from public.notifications
  where id = p_notification_id
  for update;

  if not found then
    return jsonb_build_object('error', 'Notification was not found.');
  end if;

  if public.organization_role(notification_row.organization_id) is distinct from 'admin' then
    raise exception 'Only admins can update notifications.';
  end if;

  if notification_row.read_at is not null then
    return jsonb_build_object('success', true, 'alreadyRead', true, 'paymentId', notification_row.payment_id);
  end if;

  if notification_row.notification_type = 'payment_sent' and notification_row.payment_id is null then
    select program_id
    into season_program_id
    from public.seasons
    where id = notification_row.season_id;

    select sessions.id
    into latest_session_id
    from public.attendance
    join public.sessions on sessions.id = attendance.session_id
    where attendance.player_id = notification_row.player_id
      and sessions.season_id = notification_row.season_id
      and attendance.status in ('played', 'confirmed')
    order by sessions.session_date desc, sessions.created_at desc, sessions.id desc
    limit 1;

    insert into public.payments(
      organization_id,
      program_id,
      season_id,
      session_id,
      player_id,
      payment_date,
      amount,
      payment_method,
      reference_note,
      created_by
    )
    values (
      notification_row.organization_id,
      season_program_id,
      notification_row.season_id,
      latest_session_id,
      notification_row.player_id,
      (notification_row.created_at at time zone 'America/Toronto')::date,
      notification_row.amount,
      'e-transfer',
      'Payment sent notification ' || notification_row.id::text,
      actor_id
    )
    returning id into inserted_payment_id;

    insert into public.ledger_entries(
      organization_id,
      program_id,
      season_id,
      session_id,
      player_id,
      type,
      amount,
      description,
      created_by
    )
    values (
      notification_row.organization_id,
      season_program_id,
      notification_row.season_id,
      latest_session_id,
      notification_row.player_id,
      'payment_received',
      notification_row.amount,
      'Payment sent notification ' || notification_row.id::text,
      actor_id
    )
    returning id into inserted_ledger_entry_id;
  end if;

  update public.notifications
  set
    read_at = now(),
    read_by = actor_id,
    payment_id = coalesce(payment_id, inserted_payment_id),
    ledger_entry_id = coalesce(ledger_entry_id, inserted_ledger_entry_id)
  where id = p_notification_id;

  return jsonb_build_object(
    'success', true,
    'alreadyRead', false,
    'paymentId', inserted_payment_id,
    'ledgerEntryId', inserted_ledger_entry_id,
    'sessionId', latest_session_id
  );
end;
$$;

grant execute on function public.accept_notification(uuid) to authenticated, service_role;

with notification_sessions as (
  select
    notifications.id notification_id,
    notifications.payment_id,
    notifications.ledger_entry_id,
    latest_sessions.session_id
  from public.notifications
  cross join lateral (
    select sessions.id session_id
    from public.attendance
    join public.sessions on sessions.id = attendance.session_id
    where attendance.player_id = notifications.player_id
      and sessions.season_id = notifications.season_id
      and attendance.status in ('played', 'confirmed')
    order by sessions.session_date desc, sessions.created_at desc, sessions.id desc
    limit 1
  ) latest_sessions
  where notifications.notification_type = 'payment_sent'
    and latest_sessions.session_id is not null
)
update public.payments
set session_id = notification_sessions.session_id
from notification_sessions
where payments.id = notification_sessions.payment_id
  and payments.session_id is null;

with notification_sessions as (
  select
    notifications.id notification_id,
    notifications.payment_id,
    notifications.ledger_entry_id,
    latest_sessions.session_id
  from public.notifications
  cross join lateral (
    select sessions.id session_id
    from public.attendance
    join public.sessions on sessions.id = attendance.session_id
    where attendance.player_id = notifications.player_id
      and sessions.season_id = notifications.season_id
      and attendance.status in ('played', 'confirmed')
    order by sessions.session_date desc, sessions.created_at desc, sessions.id desc
    limit 1
  ) latest_sessions
  where notifications.notification_type = 'payment_sent'
    and latest_sessions.session_id is not null
)
update public.ledger_entries
set session_id = notification_sessions.session_id
from notification_sessions
where ledger_entries.id = notification_sessions.ledger_entry_id
  and ledger_entries.session_id is null;


-- SOURCE: 072_public_longest_winning_streaks.sql
create or replace function public.public_longest_winning_streaks(p_season_id uuid default null)
returns table(
  player_id uuid,
  player_name text,
  season_id uuid,
  season_name text,
  streak_count integer,
  start_session_date date,
  end_session_date date,
  session_names text[]
)
language sql
stable
security definer
set search_path = public
as $$
  with winning_streaks as (
    select *
    from public.public_player_session_streaks(p_season_id)
    where streak_type = 'winning'
  ),
  leaders as (
    select
      ws.*,
      row_number() over (
        partition by ws.player_id
        order by ws.end_session_date desc, ws.start_session_date desc
      ) player_streak_rank
    from winning_streaks ws
    where ws.streak_count = (select max(streak_count) from winning_streaks)
  )
  select
    player_id,
    player_name,
    season_id,
    season_name,
    streak_count,
    start_session_date,
    end_session_date,
    session_names
  from leaders
  where player_streak_rank = 1
  order by player_name;
$$;

grant execute on function public.public_longest_winning_streaks(uuid) to anon, authenticated, service_role;


-- SOURCE: 073_admin_player_credit_remaining.sql
-- Player credit is calculated independently from the cash/expense dashboard.
-- Payments are authoritative for money received. The matching
-- ledger_entries.payment_received rows are intentionally excluded so that a
-- payment is never counted twice.
--
-- Session charges are authoritative for consumed credit. Ledger
-- session_used rows mirror those charges and are also intentionally excluded.
-- Completed refunds and credit transfers are sourced from the ledger because
-- they have no equivalent first-class table. A manual_adjustment amount is
-- signed: positive adds credit and negative removes credit.

create or replace view public.player_available_credit_summary
with (security_invoker = true) as
with payment_totals as (
  select
    p.organization_id,
    coalesce(p.program_id, s.program_id) as program_id,
    p.player_id,
    sum(coalesce(p.amount, 0))::numeric as payment_amount
  from public.payments p
  left join public.seasons s on s.id = p.season_id
  group by p.organization_id, coalesce(p.program_id, s.program_id), p.player_id
),
charge_totals as (
  select
    spc.organization_id,
    coalesce(spc.program_id, s.program_id) as program_id,
    spc.player_id,
    sum(coalesce(spc.amount, 0))::numeric as consumed_amount
  from public.session_player_charges spc
  join public.sessions s on s.id = spc.session_id
  join public.attendance a
    on a.session_id = spc.session_id
   and a.player_id = spc.player_id
  where s.status <> 'cancelled'
    and (
      a.status in ('played', 'replacement')
      or (
        a.status = 'confirmed'
        and (s.status = 'completed' or s.session_date < (now() at time zone 'America/Toronto')::date)
      )
    )
  group by spc.organization_id, coalesce(spc.program_id, s.program_id), spc.player_id
),
ledger_adjustments as (
  select
    le.organization_id,
    coalesce(le.program_id, s.program_id) as program_id,
    le.player_id,
    sum(
      case
        when le.type in ('credit_added', 'credit_transferred_in') then coalesce(le.amount, 0)
        when le.type in ('credit_transferred_out', 'refund_paid') then -coalesce(le.amount, 0)
        when le.type = 'manual_adjustment' then coalesce(le.amount, 0)
        else 0
      end
    )::numeric as adjustment_amount
  from public.ledger_entries le
  left join public.seasons s on s.id = le.season_id
  where le.type in (
    'credit_added',
    'credit_transferred_in',
    'credit_transferred_out',
    'refund_paid',
    'manual_adjustment'
  )
  group by le.organization_id, coalesce(le.program_id, s.program_id), le.player_id
),
account_keys as (
  select organization_id, program_id, player_id from payment_totals
  union
  select organization_id, program_id, player_id from charge_totals
  union
  select organization_id, program_id, player_id from ledger_adjustments
),
balances as (
  select
    k.organization_id,
    k.program_id,
    k.player_id,
    p.display_name as player_name,
    p.status as player_status,
    coalesce(pt.payment_amount, 0)::numeric as payment_amount,
    coalesce(ct.consumed_amount, 0)::numeric as consumed_amount,
    coalesce(la.adjustment_amount, 0)::numeric as adjustment_amount,
    (
      coalesce(pt.payment_amount, 0)
      - coalesce(ct.consumed_amount, 0)
      + coalesce(la.adjustment_amount, 0)
    )::numeric as balance_amount
  from account_keys k
  join public.players p on p.id = k.player_id
  left join payment_totals pt
    on pt.organization_id = k.organization_id
   and pt.program_id is not distinct from k.program_id
   and pt.player_id = k.player_id
  left join charge_totals ct
    on ct.organization_id = k.organization_id
   and ct.program_id is not distinct from k.program_id
   and ct.player_id = k.player_id
  left join ledger_adjustments la
    on la.organization_id = k.organization_id
   and la.program_id is not distinct from k.program_id
   and la.player_id = k.player_id
)
select
  organization_id,
  program_id,
  player_id,
  player_name,
  player_status,
  round(payment_amount, 2) as payment_amount,
  round(consumed_amount, 2) as consumed_amount,
  round(adjustment_amount, 2) as adjustment_amount,
  round(balance_amount, 2) as balance_amount,
  round(greatest(balance_amount, 0), 2) as available_credit_amount
from balances;

create or replace function public.admin_total_player_credit_remaining(
  p_program_id uuid default null
)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select round(coalesce(sum(credit.available_credit_amount), 0), 2)
  from public.player_available_credit_summary credit
  where p_program_id is null or credit.program_id = p_program_id;
$$;

grant select on public.player_available_credit_summary to authenticated;
grant execute on function public.admin_total_player_credit_remaining(uuid) to authenticated;

comment on view public.player_available_credit_summary is
  'Per-player, per-program available credit across all seasons. Positive balances are club liabilities; inactive players remain included.';

comment on function public.admin_total_player_credit_remaining(uuid) is
  'Sums positive player credit without allowing balances owed by other players to reduce the total.';


-- SOURCE: 074_player_refunds.sql
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


-- SOURCE: 075_season_credit_carry_forward.sql
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


-- SOURCE: 076_dashboard_season_finance.sql
create or replace function public.public_report_season(
  p_organization_slug text default 'ou-soccer',
  p_program_slug text default null
)
returns table(season_id uuid, season_name text)
language sql stable security definer set search_path = public as $$
  select s.id, s.name
  from public.seasons s
  join public.organizations o on o.id = s.organization_id
  left join public.programs p on p.id = s.program_id
  where o.slug = p_organization_slug and o.public_reports_enabled
    and (p_program_slug is null or p.slug = p_program_slug)
  order by (s.status = 'active') desc, s.start_date desc nulls last,
    s.created_at desc nulls last, s.id
  limit 1;
$$;

revoke all on function public.public_report_season(text, text) from public;
grant execute on function public.public_report_season(text, text) to anon, authenticated;

create or replace function public.admin_dashboard_season_finance(p_season_id uuid)
returns table(
  signup_collected numeric, drop_in_collected numeric, total_collected numeric,
  total_expenses numeric, total_refunded numeric, club_balance numeric,
  total_player_credit numeric, total_waived numeric, net_club_balance numeric,
  player_count bigint
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_season public.seasons%rowtype;
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
    select coalesce(sum(e.amount), 0)::numeric expenses
    from public.club_expenses e
    where e.organization_id = v_season.organization_id
      and (e.season_id = v_season.id or (e.season_id is null
        and (v_season.program_id is null or e.program_id = v_season.program_id)))
  ), refunded as (
    select coalesce(sum(le.amount), 0)::numeric refunds
    from public.ledger_entries le
    where le.season_id = v_season.id and le.organization_id = v_season.organization_id and le.type = 'refund_paid'
  ), credits as (
    select coalesce(sum(greatest(coalesce(ps.credit_amount, 0), 0)), 0)::numeric credit,
      coalesce(sum(ps.waived_amount), 0)::numeric waived
    from public.player_season_payment_summary ps where ps.season_id = v_season.id
  ), participants as (
    select a.player_id from public.attendance a join public.sessions s on s.id = a.session_id where s.season_id = v_season.id
    union
    select p.player_id from public.payments p where p.season_id = v_season.id
    union
    select le.player_id from public.ledger_entries le where le.season_id = v_season.id
  ), players as (
    select count(*) count from participants x join public.players p on p.id = x.player_id
    where p.organization_id = v_season.organization_id and p.status = 'active'
  )
  select round(paid.signup, 2), round(paid.drop_in, 2), round(paid.signup + paid.drop_in, 2),
    round(spent.expenses, 2), round(refunded.refunds, 2),
    round(paid.signup + paid.drop_in - spent.expenses - refunded.refunds, 2),
    round(credits.credit, 2), round(credits.waived, 2),
    round(paid.signup + paid.drop_in - spent.expenses - refunded.refunds - credits.credit, 2), players.count
  from paid cross join spent cross join refunded cross join credits cross join players;
end;
$$;

revoke all on function public.admin_dashboard_season_finance(uuid) from public, anon;
grant execute on function public.admin_dashboard_season_finance(uuid) to authenticated;


-- SOURCE: 077_carry_forward_balances.sql
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


-- SOURCE: 078_club_balance_transfers.sql
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


-- SOURCE: 079_public_report_signup_roster.sql
-- Confirmed signup rosters identify season members even before payment or attendance.
-- Use the reviewed player UUIDs saved by the importer, never a name match.
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
  with signup_roster as (
    select distinct wi.season_id, wi.organization_id,
      imported_player ->> 'matchedPlayerId' player_id
    from public.whatsapp_imports wi
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(wi.parsed_json -> 'players') = 'array'
        then wi.parsed_json -> 'players' else '[]'::jsonb end
    ) imported_player
    where wi.status = 'confirmed'
      and wi.parsed_json ->> 'importType' = 'season_signup'
      and imported_player ->> 'matchedPlayerId' is not null
  ),
  attendance_usage as (
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
    ) ranked where rn = 1
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
  left join signup_roster sr
    on sr.player_id = p.id::text and sr.season_id = s.id
      and sr.organization_id = p.organization_id
  left join attendance_usage u on u.player_id = p.id and u.season_id = s.id
  left join scored sc on sc.player_id = p.id and sc.season_id = s.id
  left join assisted ast on ast.player_id = p.id and ast.season_id = s.id
  left join completed_sessions cs on cs.player_id = p.id and cs.season_id = s.id
  left join upcoming_sessions ups on ups.player_id = p.id and ups.season_id = s.id
  where p.status = 'active' and p.organization_id = s.organization_id
    and (sr.player_id is not null
      or coalesce(ps.total_paid_amount, 0) > 0
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


-- SOURCE: 080_player_credit_transfers.sql
-- Player-to-player transfers move existing funds within one season, never cash receipts.
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
  if v_season.id is null or public.organization_role(v_season.organization_id) is distinct from 'admin' then
    raise exception 'Only an organization admin can transfer player credit';
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
revoke all on function public.transfer_player_credit(uuid, uuid, uuid, numeric, date, uuid, text, uuid) from public, anon;
grant execute on function public.transfer_player_credit(uuid, uuid, uuid, numeric, date, uuid, text, uuid) to authenticated;


-- SOURCE: 088_integrated_program_finance.sql
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


-- SOURCE: 089_integrated_scoped_reports.sql
-- Public exports and notification actions use the same enabled tenant/program scope.
create or replace function public.resolve_enabled_public_scope(p_organization_slug text, p_program_slug text default null)
returns table (organization_id uuid, program_id uuid)
language sql stable security definer set search_path = public as $$
  select org.id, program.id
  from public.organizations org
  join public.programs program on program.organization_id = org.id
    and (nullif(public.normalize_slug(p_program_slug), '') is null or program.slug = public.normalize_slug(p_program_slug))
    and program.status = 'active'
  where org.slug = public.normalize_slug(p_organization_slug)
    and org.onboarding_status = 'active' and org.public_reports_enabled
    and public.is_program_module_enabled(program.id, 'public_reports');
$$;

create or replace function public.public_report_season(p_organization_slug text default null, p_program_slug text default null)
returns table(season_id uuid, season_name text)
language sql stable security definer set search_path = public as $$
  select s.id, s.name
  from public.resolve_enabled_public_scope(p_organization_slug, p_program_slug) scope
  join public.seasons s on s.organization_id = scope.organization_id
    and (scope.program_id is null or s.program_id = scope.program_id)
  where public.is_program_module_enabled(s.program_id, 'public_reports')
  order by (s.status = 'active') desc, s.start_date desc nulls last, s.created_at desc nulls last, s.id
  limit 1;
$$;

create or replace function public.scoped_public_longest_winning_streaks(
  p_organization_slug text, p_program_slug text default null, p_season_id uuid default null
)
returns table(player_id uuid, player_name text, season_id uuid, season_name text,
  streak_count integer, start_session_date date, end_session_date date, session_names text[])
language sql stable security definer set search_path = public as $$
  select streaks.*
  from public.resolve_enabled_public_scope(p_organization_slug, p_program_slug) scope
  join public.seasons s on s.organization_id = scope.organization_id
    and (scope.program_id is null or s.program_id = scope.program_id)
    and (p_season_id is null or s.id = p_season_id)
  cross join lateral public.public_longest_winning_streaks(s.id) streaks
  where public.is_program_module_enabled(s.program_id, 'public_reports');
$$;

create or replace function public.scoped_public_payment_notification_keys(p_organization_slug text, p_program_slug text default null)
returns table(player_id uuid, season_id uuid, amount numeric)
language sql stable security definer set search_path = public as $$
  select n.player_id, n.season_id, n.amount
  from public.resolve_enabled_public_scope(p_organization_slug, p_program_slug) scope
  join public.organization_settings settings on settings.organization_id = scope.organization_id
  join public.seasons s on s.organization_id = scope.organization_id
    and (scope.program_id is null or s.program_id = scope.program_id)
  join public.notifications n on n.season_id = s.id and n.organization_id = scope.organization_id
  where settings.public_balances_enabled and settings.public_payments_enabled
    and public.is_program_module_enabled(s.program_id, 'public_reports')
    and public.is_program_module_enabled(s.program_id, 'payments');
$$;

create or replace function public.scoped_submit_payment_sent_notification(
  p_organization_slug text, p_program_slug text, p_player_id uuid, p_season_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.resolve_enabled_public_scope(p_organization_slug, p_program_slug) scope
    join public.organization_settings settings on settings.organization_id = scope.organization_id
    join public.seasons s on s.organization_id = scope.organization_id and s.id = p_season_id
      and (scope.program_id is null or s.program_id = scope.program_id)
    join public.players p on p.organization_id = scope.organization_id and p.id = p_player_id
    where settings.public_balances_enabled and settings.public_payments_enabled
      and public.is_program_module_enabled(s.program_id, 'public_reports')
      and public.is_program_module_enabled(s.program_id, 'payments')
  ) then raise exception 'Payment notifications are unavailable for this scope'; end if;
  return public.submit_payment_sent_notification(p_player_id, p_season_id);
end;
$$;

-- Financial dashboard reads must respect program membership even for tenant members.
create or replace function public.internal_scoped_player_report(p_organization_slug text, p_program_slug text default null)
returns table(player_id uuid, player_name text, season_id uuid, season_name text,
  total_paid_amount numeric, total_played_sessions numeric, confirmed_sessions numeric,
  estimated_used_amount numeric, credit_amount numeric, owes_money numeric, balance_amount numeric,
  goals integer, assists integer, appearances integer, last_attended_sessions text[], latest_session text, upcoming_session text)
language sql stable security definer set search_path = public as $$
  select report.* from public.organizations o
  join public.seasons s on s.organization_id = o.id
  join public.programs p on p.id = s.program_id
  join public.public_player_report() report on report.season_id = s.id
  where o.slug = public.normalize_slug(p_organization_slug)
    and (nullif(public.normalize_slug(p_program_slug), '') is null or p.slug = public.normalize_slug(p_program_slug))
    and public.can_manage_program_finance(p.id);
$$;

revoke all on function public.public_longest_winning_streaks(uuid) from public, anon, authenticated;
revoke all on function public.public_latest_winning_streaks(uuid) from public, anon, authenticated;
revoke all on function public.public_payment_notification_keys() from public, anon, authenticated;
revoke all on function public.submit_payment_sent_notification(uuid, uuid) from public, anon, authenticated;
revoke all on function public.scoped_public_longest_winning_streaks(text, text, uuid) from public;
revoke all on function public.scoped_public_payment_notification_keys(text, text) from public;
revoke all on function public.scoped_submit_payment_sent_notification(text, text, uuid, uuid) from public;
grant execute on function public.scoped_public_longest_winning_streaks(text, text, uuid) to anon, authenticated;
grant execute on function public.scoped_public_payment_notification_keys(text, text) to anon, authenticated;
grant execute on function public.scoped_submit_payment_sent_notification(text, text, uuid, uuid) to anon, authenticated;


-- SOURCE: 090_import_program_scope.sql
-- Imports and legacy writes inherit scope from their selected season/session,
-- rather than the signed-in user's first organization or a default program.
alter table public.whatsapp_imports add column if not exists program_id uuid references public.programs(id);
update public.whatsapp_imports wi set program_id = s.program_id
from public.seasons s where s.id = wi.season_id and wi.program_id is null;
update public.whatsapp_imports wi set program_id = s.program_id
from public.sessions s where s.id = wi.session_id and wi.program_id is null;

create or replace function public.derive_season_program_scope()
returns trigger language plpgsql set search_path = public as $$
declare
  payload jsonb := to_jsonb(new);
  parent_season uuid := nullif(payload->>'season_id','')::uuid;
  parent_session uuid := nullif(payload->>'session_id','')::uuid;
  session_season uuid;
  scope_org uuid;
  scope_program uuid;
  player_key text;
begin
  if parent_session is not null then
    select season_id into session_season from public.sessions where id = parent_session;
    if session_season is null then raise exception 'Session is unavailable'; end if;
    if parent_season is not null and parent_season <> session_season then
      raise exception 'Session must belong to the selected season';
    end if;
    parent_season := session_season;
  end if;
  if parent_season is null then return new; end if;
  select organization_id, program_id into scope_org, scope_program from public.seasons where id = parent_season;
  if scope_program is null then raise exception 'Season program is unavailable'; end if;
  if new.program_id is not null and new.program_id <> scope_program then
    raise exception 'Program must match the selected season';
  end if;
  foreach player_key in array array['player_id','related_player_id','original_player_id','replacement_player_id','scorer_id','assist_player_id'] loop
    if nullif(payload->>player_key,'') is not null and not exists (
      select 1 from public.players p where p.id = (payload->>player_key)::uuid and p.organization_id = scope_org
    ) then raise exception 'Player must belong to the selected organization'; end if;
  end loop;
  new.organization_id := scope_org;
  new.program_id := scope_program;
  return new;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array['sessions','payments','attendance','dropouts','ledger_entries',
    'session_player_charges','session_teams','session_team_players','session_matches','goals','club_expenses','whatsapp_imports'] loop
    execute format('create trigger a_derive_season_program_scope before insert or update on public.%I
      for each row execute function public.derive_season_program_scope()', table_name);
  end loop;
  foreach table_name in array array['seasons','sessions'] loop
    execute format('create policy integrated_activity_manager on public.%I for all to authenticated
      using (public.can_manage_program_finance(program_id, ''activities''))
      with check (public.can_manage_program_finance(program_id, ''activities''))', table_name);
  end loop;
end;
$$;

create policy integrated_import_scope on public.whatsapp_imports as restrictive for all to authenticated
using (public.can_access_program(program_id)) with check (public.can_access_program(program_id));
create policy integrated_import_manager on public.whatsapp_imports for all to authenticated
using (public.can_manage_program_finance(program_id, 'whatsapp_import'))
with check (public.can_manage_program_finance(program_id, 'whatsapp_import'));
create trigger prevent_disabled_program_writes before insert or update or delete on public.whatsapp_imports
for each row execute function public.prevent_disabled_program_writes('whatsapp_import');

create policy integrated_import_alias_manager on public.player_aliases for all to authenticated
using (exists (select 1 from public.programs p where p.organization_id = player_aliases.organization_id
  and public.can_manage_program_finance(p.id, 'whatsapp_import')))
with check (exists (select 1 from public.programs p where p.organization_id = player_aliases.organization_id
  and public.can_manage_program_finance(p.id, 'whatsapp_import')));
create policy integrated_import_playground_manager on public.playgrounds for insert to authenticated
with check (exists (select 1 from public.programs p where p.organization_id = playgrounds.organization_id
  and public.can_manage_program_finance(p.id, 'whatsapp_import')));


-- SOURCE: 091_historical_program_scope.sql
-- Preserve historical records while making their existing parent scope explicit.
do $$
declare
  target text;
  parent text;
  parent_key text;
  invalid_count bigint;
begin
  foreach target in array array['payments','ledger_entries','session_player_charges','club_expenses',
    'attendance','dropouts','goals','session_matches','session_team_players','session_teams','whatsapp_imports'] loop
    if target in ('attendance','dropouts','goals','session_matches','session_team_players','session_teams') then
      parent := 'sessions'; parent_key := 'session_id';
    else
      parent := 'seasons'; parent_key := 'season_id';
    end if;
    execute format('select count(*) from public.%I child join public.%I parent on parent.id=child.%I
      where child.organization_id <> parent.organization_id
         or (child.program_id is not null and child.program_id is distinct from parent.program_id)',target,parent,parent_key)
      into invalid_count;
    if invalid_count > 0 then raise exception 'Conflicting historical scope in %; review before upgrading',target; end if;
    execute format('update public.%I child set program_id=parent.program_id
      from public.%I parent where parent.id=child.%I and child.program_id is null and parent.program_id is not null',target,parent,parent_key);
  end loop;
end;
$$;


-- SOURCE: 092_development_organization_refresh.sql
-- No target is enabled by this migration. Operators configure development only.
create table public.development_refresh_targets (
  organization_id uuid primary key references public.organizations(id),
  enabled boolean not null default false,
  source_ref text not null check(source_ref = 'uqntqbcimkyoiptvtrem'),
  target_ref text not null check(target_ref = 'vnmloamscqaqmagimfmz'),
  check(source_ref <> target_ref)
);
create table public.development_refresh_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  requested_by uuid not null references public.profiles(id),
  status text not null default 'analyze_queued' check(status in
    ('analyze_queued','analyzing','preview_ready','apply_queued','applying','succeeded','failed','cancelled','expired')),
  preview jsonb,
  snapshot_hash text,
  error text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index development_refresh_one_active on public.development_refresh_jobs(organization_id)
  where status in ('analyze_queued','analyzing','preview_ready','apply_queued','applying');

alter table public.development_refresh_targets enable row level security;
alter table public.development_refresh_jobs enable row level security;
revoke all on public.development_refresh_targets,public.development_refresh_jobs from public,anon,authenticated;
grant select on public.development_refresh_jobs to authenticated;
grant all on public.development_refresh_targets,public.development_refresh_jobs to service_role;
create policy refresh_jobs_admin_read on public.development_refresh_jobs for select to authenticated using (
  exists(select 1 from public.organization_members m where m.organization_id=development_refresh_jobs.organization_id
    and m.profile_id=auth.uid() and m.status='active' and m.role in ('owner','admin'))
);

create function public.request_development_refresh(p_organization_id uuid, p_job_id uuid default null, p_command text default 'analyze')
returns uuid language plpgsql security definer set search_path=public as $$
declare job public.development_refresh_jobs; result uuid;
begin
  if not exists(select 1 from public.organization_members where organization_id=p_organization_id
    and profile_id=auth.uid() and status='active' and role in ('owner','admin')) then
    raise exception 'Only an active organization owner or admin can refresh its development data';
  end if;
  if not exists(select 1 from public.development_refresh_targets where organization_id=p_organization_id and enabled
    and source_ref='uqntqbcimkyoiptvtrem' and target_ref='vnmloamscqaqmagimfmz') then
    raise exception 'Production refresh is not configured for this organization';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text, 92));
  update public.development_refresh_jobs set status='expired',updated_at=now()
    where organization_id=p_organization_id and status='preview_ready' and expires_at <= now();
  if p_command='analyze' then
    insert into public.development_refresh_jobs(organization_id,requested_by)
      values(p_organization_id,auth.uid()) returning id into result;
  else
    select * into job from public.development_refresh_jobs where id=p_job_id and organization_id=p_organization_id for update;
    if job.id is null or job.requested_by<>auth.uid() then raise exception 'Refresh request was not found'; end if;
    if p_command='confirm' then
      if job.status<>'preview_ready' or job.expires_at<=now() then raise exception 'Analyze again before confirming'; end if;
      update public.development_refresh_jobs set status='apply_queued',updated_at=now() where id=job.id;
    elsif p_command='cancel' and job.status in ('analyze_queued','preview_ready','apply_queued') then
      update public.development_refresh_jobs set status='cancelled',updated_at=now() where id=job.id;
    else raise exception 'This refresh cannot be changed'; end if;
    result:=job.id;
  end if;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,new_data)
    values(p_organization_id,auth.uid(),'development_refresh_'||p_command,'development_refresh_jobs',result,
      jsonb_build_object('direction','production_to_development'));
  return result;
end $$;
revoke all on function public.request_development_refresh(uuid,uuid,text) from public,anon;
grant execute on function public.request_development_refresh(uuid,uuid,text) to authenticated;


-- SOURCE: 093_native_apps.sql
-- Authenticated mobile reads deliberately do not depend on public-report visibility.
alter table public.profiles add column if not exists photo_path text;

create or replace function public.mobile_program_access(p_program_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(exists (
    select 1 from public.programs p
    join public.organizations o on o.id = p.organization_id and o.onboarding_status = 'active'
    join public.organization_members om on om.organization_id = o.id
      and om.profile_id = auth.uid() and om.status = 'active'
    where p.id = p_program_id and p.status = 'active'
      and (om.role in ('owner','admin') or exists (
        select 1 from public.program_members pm where pm.program_id = p.id
          and pm.profile_id = auth.uid() and pm.status = 'active'
      ))
  ), false);
$$;

create or replace function public.mobile_context()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_profile jsonb; v_workspaces jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select jsonb_build_object('id',id,'displayName',display_name,'email',email,'photoPath',photo_path)
    into v_profile from public.profiles where id = auth.uid();
  select coalesce(jsonb_agg(jsonb_build_object(
    'organizationId',o.id,'organizationName',o.name,'programId',p.id,'programName',p.name,
    'activityType',p.activity_type,'role',public.program_role(p.id),'organizationRole',om.role,
    'playerId',coalesce(pm.player_id,om.player_id),
    'currency',coalesce(os.currency_code,'CAD'),
    'modules',coalesce((select jsonb_object_agg(module_key,enabled) from public.program_modules where program_id=p.id),'{}'::jsonb)
  ) order by o.name,p.name),'[]'::jsonb) into v_workspaces
  from public.programs p join public.organizations o on o.id=p.organization_id
  join public.organization_members om on om.organization_id=o.id and om.profile_id=auth.uid() and om.status='active'
  left join public.program_members pm on pm.program_id=p.id and pm.profile_id=auth.uid() and pm.status='active'
  left join public.organization_settings os on os.organization_id=o.id
  where public.mobile_program_access(p.id);
  return jsonb_build_object('profile',v_profile,'workspaces',v_workspaces,'requests',coalesce((
    select jsonb_agg(jsonb_build_object('name',o.name,'status',m.status))
    from public.organization_members m join public.organizations o on o.id=m.organization_id
    where m.profile_id=auth.uid() and m.status<>'active'
  ),'[]'::jsonb));
end;
$$;

create or replace function public.mobile_list(p_program_id uuid, p_resource text, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_player uuid; v_manager boolean; v_module text; v_rows jsonb; v_currency text;
begin
  if not public.mobile_program_access(p_program_id) then raise exception 'Program access required'; end if;
  if p_offset is null or p_offset < 0 then raise exception 'Invalid page'; end if;
  v_manager := public.program_role(p_program_id)='manager';
  select coalesce(pm.player_id,om.player_id),coalesce(os.currency_code,'CAD') into v_player,v_currency
    from public.programs p
    join public.organization_members om on om.organization_id=p.organization_id and om.profile_id=auth.uid() and om.status='active'
    left join public.program_members pm on pm.program_id=p.id and pm.profile_id=auth.uid() and pm.status='active'
    left join public.organization_settings os on os.organization_id=p.organization_id where p.id=p_program_id;
  v_module := case when p_resource in ('balances','payments','myBalances','myPayments') then 'payments'
    when p_resource='expenses' then 'expenses'
    when p_resource in ('statistics','myStatistics') then 'scores'
    when p_resource in ('sessions','upcomingSessions','mySessions','seasons') then 'activities'
    when p_resource in ('members','players') then 'members' else p_resource end;
  if not public.is_program_module_enabled(p_program_id,v_module) then raise exception 'Module is disabled'; end if;
  if p_resource in ('players','expenses','members') and not v_manager then raise exception 'Manager access required'; end if;
  -- One ordered, bounded page. Financial views are only evaluated for this season scope.
  if p_resource in ('sessions','upcomingSessions','mySessions') then
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_rows from (
      select s.id,coalesce(s.name,s.session_date::text) title,
        s.session_date::text || ' / ' || s.status subtitle,coalesce(pg.name,s.location,'') detail
      from public.sessions s left join public.playgrounds pg on pg.id=s.playground_id
      where s.program_id=p_program_id
        and (p_resource<>'upcomingSessions' or (s.session_date>=current_date and s.status='scheduled'))
        and (p_resource<>'mySessions' or exists (
          select 1 from public.attendance a where a.session_id=s.id and a.player_id=v_player and a.status in ('played','replacement')
        )) order by case when p_resource='upcomingSessions' then s.session_date end asc,s.session_date desc,s.id limit 26 offset p_offset
    ) r;
  elsif p_resource='seasons' then
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_rows from (
      select id,name title,status subtitle,coalesce(start_date::text,'') || ' - ' || coalesce(end_date::text,'') detail
      from public.seasons where program_id=p_program_id order by start_date desc nulls last,id limit 26 offset p_offset
    ) r;
  elsif p_resource in ('balances','myBalances') then
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_rows from (
      select summary.player_id::text || ':' || s.id::text id,summary.player_name title,
        s.name subtitle,v_currency || ' ' || (coalesce(summary.credit_amount,0)-coalesce(summary.owes_money,0))::numeric(12,2)::text detail
      from public.seasons s join public.player_season_payment_summary summary on summary.season_id=s.id
      join public.players player on player.id=summary.player_id and player.organization_id=s.organization_id
      where s.program_id=p_program_id and ((v_manager and p_resource='balances') or summary.player_id=v_player)
      order by s.start_date desc nulls last,summary.player_name,summary.player_id,s.id limit 26 offset p_offset
    ) r;
  elsif p_resource in ('payments','myPayments') then
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_rows from (
      select l.id,p.display_name title,replace(l.type,'_',' ') || ' / ' || coalesce(l.refund_date::text,l.created_at::date::text) subtitle,
        v_currency || ' ' || coalesce(l.amount,0)::numeric(12,2)::text || ' / ' || s.name detail
      from public.ledger_entries l join public.seasons s on s.id=l.season_id join public.players p on p.id=l.player_id
      where s.program_id=p_program_id and ((v_manager and p_resource='payments') or l.player_id=v_player)
      order by l.created_at desc,l.id limit 26 offset p_offset
    ) r;
  elsif p_resource in ('statistics','myStatistics') then
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_rows from (
      select st.player_id::text || ':' || s.id::text id,p.display_name title,s.name subtitle,
        coalesce(st.goals,0)::text || ' goals / ' || coalesce(st.assists,0)::text || ' assists / ' || coalesce(st.appearances,0)::text || ' appearances' detail
      from public.player_season_stats_summary st join public.seasons s on s.id=st.season_id
      join public.players p on p.id=st.player_id and p.organization_id=s.organization_id
      where s.program_id=p_program_id and (p_resource='statistics' or p.id=v_player)
        and (st.appearances>0 or st.goals>0 or st.assists>0 or exists(
          select 1 from public.program_members pm where pm.program_id=p_program_id and pm.player_id=p.id
        ))
      order by st.goals desc,st.assists desc,st.player_id,s.id limit 26 offset p_offset
    ) r;
  elsif p_resource='players' then
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_rows from (
      select p.id,p.display_name title,p.status subtitle,coalesce(p.email,p.phone,'') detail
      from public.players p where exists(select 1 from public.program_members pm where pm.program_id=p_program_id and pm.player_id=p.id)
      order by p.display_name,p.id limit 26 offset p_offset
    ) r;
  elsif p_resource='expenses' then
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_rows from (
      select e.id,e.category title,e.expense_date::text subtitle,v_currency || ' ' || e.amount::numeric(12,2)::text detail
      from public.club_expenses e where e.program_id=p_program_id order by e.expense_date desc,e.id limit 26 offset p_offset
    ) r;
  elsif p_resource='members' then
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_rows from (
      select m.id,coalesce(p.display_name,player.display_name,'Unlinked member') title,m.role || ' / ' || m.status subtitle,
        coalesce(p.email,'') detail
      from public.program_members m left join public.profiles p on p.id=m.profile_id
      left join public.players player on player.id=m.player_id where m.program_id=p_program_id
      order by m.created_at desc,m.id limit 26 offset p_offset
    ) r;
  else raise exception 'Unknown resource';
  end if;
  return jsonb_build_object('rows',case when jsonb_array_length(v_rows)>25 then v_rows-25 else v_rows end,'hasMore',jsonb_array_length(v_rows)>25);
end;
$$;

create or replace function public.mobile_session(p_program_id uuid, p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if not public.mobile_program_access(p_program_id)
    or not public.is_program_module_enabled(p_program_id,'activities')
    or not exists(select 1 from public.sessions where id=p_session_id and program_id=p_program_id)
    then raise exception 'Session access required'; end if;
  if not public.is_program_module_enabled(p_program_id,'scores')
    or not public.is_program_module_enabled(p_program_id,'teams') then raise exception 'Match day is disabled'; end if;
  return public.public_game_score_editor(p_session_id);
end;
$$;

revoke all on function public.mobile_program_access(uuid),public.mobile_context(),public.mobile_list(uuid,text,integer),public.mobile_session(uuid,uuid) from public,anon;
grant execute on function public.mobile_program_access(uuid),public.mobile_context(),public.mobile_list(uuid,text,integer),public.mobile_session(uuid,uuid) to authenticated;

-- Private account photos. No organization identity is inferred from names or email.
-- Conditional installation permits local schema tests without Supabase Storage.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
      values('profile-photos','profile-photos',false,2097152,array['image/jpeg','image/png','image/webp'])
      on conflict(id) do update set public=false,file_size_limit=2097152,allowed_mime_types=excluded.allowed_mime_types;
    execute 'create policy profile_photos_owner_read on storage.objects for select to authenticated using
      (bucket_id = ''profile-photos'' and (storage.foldername(name))[1] = auth.uid()::text)';
    execute 'create policy profile_photos_owner_insert on storage.objects for insert to authenticated with check
      (bucket_id = ''profile-photos'' and (storage.foldername(name))[1] = auth.uid()::text)';
    execute 'create policy profile_photos_owner_delete on storage.objects for delete to authenticated using
      (bucket_id = ''profile-photos'' and (storage.foldername(name))[1] = auth.uid()::text)';
  end if;
end;
$$;

create or replace function public.set_my_photo(p_path text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or p_path not like auth.uid()::text || '/%' or length(p_path)>200
    then raise exception 'Invalid photo path'; end if;
  if not exists(select 1 from storage.objects where bucket_id='profile-photos' and name=p_path)
    then raise exception 'Upload the photo first'; end if;
  update public.profiles set photo_path=p_path where id=auth.uid();
end;
$$;
revoke all on function public.set_my_photo(text) from public,anon;
grant execute on function public.set_my_photo(text) to authenticated;

create or replace function public.mobile_save_scores(p_program_id uuid,p_session_id uuid,p_games jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;
begin
  if not public.mobile_program_access(p_program_id)
    or public.program_role(p_program_id) not in ('manager','captain')
    or not exists(select 1 from public.sessions where id=p_session_id and program_id=p_program_id and status='scheduled')
    then raise exception 'This session cannot be scored by this account'; end if;
  v_result := public.save_program_game_scores(p_session_id,p_games);
  if v_result ? 'error' then raise exception '%',v_result->>'error'; end if;
  return v_result;
end;
$$;
revoke all on function public.mobile_save_scores(uuid,uuid,jsonb) from public,anon;
grant execute on function public.mobile_save_scores(uuid,uuid,jsonb) to authenticated;

create or replace function public.mobile_record_finance(p_program_id uuid,p_kind text,p_submission_id uuid,p_data jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_org uuid; v_season public.seasons%rowtype; v_player uuid;
  v_amount numeric; v_date date; v_method text; v_note text; v_id uuid;
  v_existing public.audit_logs%rowtype;
begin
  if not public.mobile_program_access(p_program_id) or public.program_role(p_program_id)<>'manager'
    or not public.can_manage_program_finance(p_program_id,case when p_kind='expense' then 'expenses' else 'payments' end)
    then raise exception 'Manager finance access required'; end if;
  if p_submission_id is null or p_kind not in ('payment','refund','transfer','carry','expense') then raise exception 'Invalid transaction'; end if;
  select organization_id into v_org from public.programs where id=p_program_id;
  perform pg_advisory_xact_lock(hashtextextended(p_submission_id::text,0));
  select * into v_existing from public.audit_logs where id=p_submission_id;
  if found then
    if v_existing.organization_id=v_org and v_existing.actor_id=auth.uid()
      and v_existing.action='mobile_' || p_kind || '_recorded'
      and v_existing.new_data->>'program_id'=p_program_id::text and v_existing.new_data->'payload'=p_data
      then return (v_existing.new_data->>'result_id')::uuid; end if;
    raise exception 'Submission ID already used for a different transaction';
  end if;
  select * into v_season from public.seasons where id=(p_data->>'seasonId')::uuid and program_id=p_program_id;
  if not found then raise exception 'Choose a season in this program'; end if;
  if coalesce(p_data->>'amount','') !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'Enter a decimal amount'; end if;
  v_amount := (p_data->>'amount')::numeric;
  v_date := (p_data->>'date')::date;
  v_method := p_data->>'method'; v_note := nullif(btrim(p_data->>'note'),'');
  if v_amount<=0 or v_amount>99999999.99 or v_date is null or v_date>current_date
    or length(coalesce(v_note,''))>300 then raise exception 'Invalid amount, date or reference'; end if;
  if p_kind<>'expense' then
    v_player := (p_data->>'playerId')::uuid;
    perform 1 from public.players where id=v_player and organization_id=v_org for update;
    if not found then raise exception 'Player does not belong to this organization'; end if;
  end if;
  if p_kind in ('payment','refund') and (v_method is null or v_method not in ('cash','e-transfer','other')) then raise exception 'Invalid payment method'; end if;
  if p_kind='refund' then
    v_id := public.record_player_refund(v_player,v_season.id,v_amount,v_date,v_method,v_note,p_submission_id);
  elsif p_kind='transfer' then
    v_id := public.transfer_player_credit(v_player,(p_data->>'recipientId')::uuid,v_season.id,v_amount,v_date,null,v_note,p_submission_id);
  elsif p_kind='carry' then
    v_id := public.carry_forward_player_balance(v_player,v_season.id,(p_data->>'destinationSeasonId')::uuid,v_amount,v_date,v_note,p_submission_id,'credit');
  elsif p_kind='payment' then
    insert into public.payments(organization_id,program_id,season_id,player_id,payment_date,amount,sessions_covered,payment_method,reference_note,created_by)
      values(v_org,p_program_id,v_season.id,v_player,v_date,v_amount,
        case when v_season.price_per_session>0 then round(v_amount/v_season.price_per_session,2) else 0 end,
        v_method,v_note,auth.uid()) returning id into v_id;
    insert into public.ledger_entries(organization_id,program_id,season_id,player_id,type,amount,sessions_count,description,created_by)
      values(v_org,p_program_id,v_season.id,v_player,'payment_received',v_amount,
        case when v_season.price_per_session>0 then round(v_amount/v_season.price_per_session,2) else 0 end,
        coalesce(v_note,'Mobile payment ' || v_id::text),auth.uid());
  else
    insert into public.club_expenses(organization_id,program_id,season_id,expense_date,category,amount,notes,created_by)
      values(v_org,p_program_id,v_season.id,v_date,p_data->>'category',v_amount,v_note,auth.uid()) returning id into v_id;
  end if;
  insert into public.audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,new_data)
    values(p_submission_id,v_org,auth.uid(),'mobile_' || p_kind || '_recorded','mobile_transaction',v_id,
      jsonb_build_object('result_id',v_id,'program_id',p_program_id,'season_id',v_season.id,'amount',v_amount,'payload',p_data));
  return v_id;
end;
$$;
revoke all on function public.mobile_record_finance(uuid,text,uuid,jsonb) from public,anon;
grant execute on function public.mobile_record_finance(uuid,text,uuid,jsonb) to authenticated;

create or replace function public.mobile_create_record(p_program_id uuid,p_kind text,p_id uuid,p_data jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_module text; v_existing public.audit_logs%rowtype;
begin
  v_module := case when p_kind='player' then 'members' else 'activities' end;
  if not public.mobile_program_access(p_program_id) or public.program_role(p_program_id)<>'manager'
    or not public.is_program_module_enabled(p_program_id,v_module) then raise exception 'Manager access required'; end if;
  select organization_id into v_org from public.programs where id=p_program_id;
  if p_id is null or p_kind not in ('season','session','player') then raise exception 'Invalid record'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  select * into v_existing from public.audit_logs where id=p_id;
  if found then
    if v_existing.organization_id=v_org and v_existing.actor_id=auth.uid()
      and v_existing.action='mobile_create_' || p_kind and v_existing.new_data->>'program_id'=p_program_id::text
      and v_existing.new_data->'payload'=p_data then return p_id; end if;
    raise exception 'Submission ID already used';
  end if;
  if length(btrim(coalesce(p_data->>'name','')))<1 or length(p_data->>'name')>150 then raise exception 'Enter a name (maximum 150 characters)'; end if;
  if p_kind in ('season','session') and (coalesce(p_data->>'price','') !~ '^[0-9]+(\.[0-9]{1,2})?$'
    or (p_data->>'price')::numeric>99999999.99) then raise exception 'Enter a nonnegative price'; end if;
  if p_kind='season' then
    if (p_data->>'endDate')::date<(p_data->>'startDate')::date then raise exception 'End date is before start date'; end if;
    insert into public.seasons(id,organization_id,program_id,name,start_date,end_date,price_per_session,total_planned_sessions,status,created_by)
      values(p_id,v_org,p_program_id,btrim(p_data->>'name'),(p_data->>'startDate')::date,(p_data->>'endDate')::date,
        (p_data->>'price')::numeric,(p_data->>'sessions')::integer,'draft',auth.uid());
  elsif p_kind='session' then
    if not exists(select 1 from public.seasons where id=(p_data->>'seasonId')::uuid and program_id=p_program_id) then raise exception 'Season must belong to this program'; end if;
    insert into public.sessions(id,organization_id,program_id,season_id,name,session_date,start_time,end_time,price_per_session,location,created_by)
      values(p_id,v_org,p_program_id,(p_data->>'seasonId')::uuid,btrim(p_data->>'name'),(p_data->>'date')::date,
        (p_data->>'startTime')::time,(p_data->>'endTime')::time,(p_data->>'price')::numeric,p_data->>'location',auth.uid());
  else
    insert into public.players(id,organization_id,display_name,email,phone,status)
      values(p_id,v_org,btrim(p_data->>'name'),nullif(btrim(p_data->>'email'),''),nullif(btrim(p_data->>'phone'),''),'active');
    insert into public.program_members(organization_id,program_id,player_id,role,status)
      values(v_org,p_program_id,p_id,'member','active');
  end if;
  insert into public.audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,new_data)
    values(p_id,v_org,auth.uid(),'mobile_create_' || p_kind,p_kind,p_id,jsonb_build_object('program_id',p_program_id,'payload',p_data));
  return p_id;
end;
$$;
revoke all on function public.mobile_create_record(uuid,text,uuid,jsonb) from public,anon;
grant execute on function public.mobile_create_record(uuid,text,uuid,jsonb) to authenticated;

create or replace function public.mobile_credit_preview(p_program_id uuid,p_season_id uuid,p_player_id uuid)
returns text language plpgsql stable security definer set search_path=public as $$
declare v_credit numeric;
begin
  if not public.mobile_program_access(p_program_id) or public.program_role(p_program_id)<>'manager'
    or not public.can_manage_program_finance(p_program_id) then raise exception 'Manager finance access required'; end if;
  if not exists(select 1 from public.seasons s join public.players p on p.organization_id=s.organization_id
    where s.id=p_season_id and s.program_id=p_program_id and p.id=p_player_id) then raise exception 'Invalid season or player'; end if;
  select credit_amount into v_credit from public.player_season_payment_summary where season_id=p_season_id and player_id=p_player_id;
  return coalesce(v_credit,0)::numeric(12,2)::text;
end;
$$;
revoke all on function public.mobile_credit_preview(uuid,uuid,uuid) from public,anon;
grant execute on function public.mobile_credit_preview(uuid,uuid,uuid) to authenticated;

create or replace function public.mobile_member(p_program_id uuid,p_member_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_member jsonb;
begin
  if not public.mobile_program_access(p_program_id) or public.program_role(p_program_id)<>'manager'
    or not public.is_program_module_enabled(p_program_id,'members') then raise exception 'Manager access required'; end if;
  select jsonb_build_object('id',m.id,'name',coalesce(profile.display_name,player.display_name),
    'role',m.role,'status',m.status,'organizationStatus',om.status,'email',profile.email)
    into v_member from public.program_members m
    left join public.profiles profile on profile.id=m.profile_id
    left join public.players player on player.id=m.player_id
    left join public.organization_members om on om.organization_id=m.organization_id and om.profile_id=m.profile_id
    where m.id=p_member_id and m.program_id=p_program_id;
  if v_member is null then raise exception 'Member not found'; end if;
  return v_member;
end;
$$;
create or replace function public.mobile_update_member(p_program_id uuid,p_member_id uuid,p_role text,p_status text,p_approve_organization boolean default false)
returns void language plpgsql security definer set search_path=public as $$
declare v_member public.program_members%rowtype; v_org_role text; v_target_org_role text;
begin
  if not public.mobile_program_access(p_program_id) or public.program_role(p_program_id)<>'manager'
    or not public.is_program_module_enabled(p_program_id,'members') then raise exception 'Manager access required'; end if;
  if p_role is null or p_role not in ('manager','captain','member') or p_status is null or p_status not in ('pending','active','rejected','suspended') then raise exception 'Invalid role or status'; end if;
  select * into v_member from public.program_members where id=p_member_id and program_id=p_program_id for update;
  if not found or v_member.profile_id=auth.uid() then raise exception 'Cannot modify this membership'; end if;
  select role into v_org_role from public.organization_members where organization_id=v_member.organization_id and profile_id=auth.uid() and status='active';
  select role into v_target_org_role from public.organization_members where organization_id=v_member.organization_id and profile_id=v_member.profile_id;
  if v_target_org_role in ('owner','admin') then raise exception 'Organization administrators must be managed on the website'; end if;
  if v_org_role not in ('owner','admin') and (v_member.role='manager' or p_role='manager' or p_approve_organization) then raise exception 'Organization administrator required'; end if;
  if p_approve_organization then
    update public.organization_members set status='active' where organization_id=v_member.organization_id and profile_id=v_member.profile_id and role='player' and status='pending';
  end if;
  if p_status='active' and v_member.profile_id is not null and not exists(
    select 1 from public.organization_members where organization_id=v_member.organization_id and profile_id=v_member.profile_id and status='active'
  ) then raise exception 'Organization membership must be approved first'; end if;
  update public.program_members set role=p_role,status=p_status where id=p_member_id;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,old_data,new_data)
    values(v_member.organization_id,auth.uid(),'mobile_membership_updated','program_members',p_member_id,
      to_jsonb(v_member),jsonb_build_object('role',p_role,'status',p_status,'organization_approved',p_approve_organization));
end;
$$;
revoke all on function public.mobile_member(uuid,uuid),public.mobile_update_member(uuid,uuid,text,text,boolean) from public,anon;
grant execute on function public.mobile_member(uuid,uuid),public.mobile_update_member(uuid,uuid,text,text,boolean) to authenticated;


-- SOURCE: 094_mobile_session_operations.sql
-- Review before deployment. No historical data is modified by this migration.
create or replace function public.mobile_session_roster(p_program_id uuid,p_session_id uuid,p_offset integer default 0,p_query text default '')
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_session public.sessions%rowtype; v_rows jsonb;
begin
  if not public.mobile_program_access(p_program_id) or public.program_role(p_program_id) not in ('manager','captain')
    or not public.is_program_module_enabled(p_program_id,'attendance') then raise exception 'Attendance access required'; end if;
  if p_offset is null or p_offset<0 or length(coalesce(p_query,''))>100 then raise exception 'Invalid page or search'; end if;
  select * into v_session from public.sessions where id=p_session_id and program_id=p_program_id;
  if not found then raise exception 'Session not found in this program'; end if;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_rows from (
    select p.id,p.display_name as name,a.status,coalesce(a.notes,'') as notes
    from public.players p left join public.attendance a on a.player_id=p.id and a.session_id=p_session_id
    where p.organization_id=v_session.organization_id
      and (a.id is not null or exists(select 1 from public.program_members pm where pm.program_id=p_program_id and pm.player_id=p.id))
      and position(lower(coalesce(p_query,'')) in lower(p.display_name))>0
    order by p.display_name,p.id limit 26 offset p_offset
  ) r;
  return jsonb_build_object('session',jsonb_build_object('id',v_session.id,'name',v_session.name,'date',v_session.session_date,'status',v_session.status),
    'rows',case when jsonb_array_length(v_rows)>25 then v_rows-25 else v_rows end,'hasMore',jsonb_array_length(v_rows)>25,
    'canComplete',public.program_role(p_program_id)='manager' and public.is_program_module_enabled(p_program_id,'activities'));
end;
$$;

create or replace function public.mobile_session_operation(p_program_id uuid,p_session_id uuid,p_action text,p_submission_id uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_session public.sessions%rowtype; v_old public.attendance%rowtype; v_a public.attendance%rowtype;
  v_charge public.session_player_charges%rowtype; v_existing public.audit_logs%rowtype;
  v_player uuid; v_status text; v_price numeric; v_charge_id uuid; v_ledger_id uuid;
  v_completed boolean; v_changed integer:=0; v_removed integer:=0; v_new integer:=0;
  v_payload jsonb; v_result jsonb; v_season uuid;
begin
  if not public.mobile_program_access(p_program_id) or public.program_role(p_program_id) not in ('manager','captain')
    or not public.is_program_module_enabled(p_program_id,'attendance') then raise exception 'Attendance access required'; end if;
  if p_action is null or p_action not in ('attendance','complete') or p_submission_id is null or jsonb_typeof(p_data) is distinct from 'object'
    then raise exception 'Invalid operation'; end if;
  if p_action='complete' and (public.program_role(p_program_id)<>'manager' or not public.is_program_module_enabled(p_program_id,'activities'))
    then raise exception 'Manager access required to complete sessions'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_submission_id::text,0));
  v_payload:=jsonb_build_object('programId',p_program_id,'sessionId',p_session_id,'action',p_action,'data',p_data);
  select * into v_existing from public.audit_logs where id=p_submission_id;
  if found then
    if v_existing.actor_id=auth.uid() and v_existing.action='mobile_session_operation' and v_existing.new_data->'payload'=v_payload
      then return v_existing.new_data->'result'; end if;
    raise exception 'Submission ID already used';
  end if;
  select season_id into v_season from public.sessions where id=p_session_id and program_id=p_program_id;
  if not found then raise exception 'Session not found in this program'; end if;
  perform 1 from public.seasons where id=v_season for update;
  select * into v_session from public.sessions where id=p_session_id and program_id=p_program_id for update;
  if v_session.season_id is distinct from v_season then raise exception 'Session changed; reload before saving'; end if;
  if v_session.status='cancelled' then raise exception 'Cancelled sessions cannot be changed'; end if;
  if p_action='attendance' then
    v_player:=(p_data->>'playerId')::uuid; v_status:=p_data->>'status';
    if v_status is null or v_status not in ('confirmed','played','absent','dropped','replacement','waitlisted') or length(coalesce(p_data->>'notes',''))>1000
      then raise exception 'Invalid attendance'; end if;
    if not exists(select 1 from public.players p where p.id=v_player and p.organization_id=v_session.organization_id
      and (exists(select 1 from public.program_members pm where pm.program_id=p_program_id and pm.player_id=p.id)
        or exists(select 1 from public.attendance a where a.session_id=p_session_id and a.player_id=p.id)))
      then raise exception 'Player not in this program or session'; end if;
    select * into v_old from public.attendance where session_id=p_session_id and player_id=v_player for update;
    if v_old.status is distinct from (p_data->>'expectedStatus') then raise exception 'Attendance changed; reload before saving'; end if;
    insert into public.attendance(organization_id,program_id,session_id,player_id,status,notes,created_by)
      values(v_session.organization_id,p_program_id,p_session_id,v_player,v_status,nullif(p_data->>'notes',''),auth.uid())
      on conflict(session_id,player_id) do update set status=excluded.status,notes=excluded.notes;
  end if;
  select coalesce(v_session.price_per_session,price_per_session,0) into v_price from public.seasons where id=v_season;
  v_completed:=p_action='complete' or v_session.status='completed' or v_session.session_date<(now() at time zone 'America/Toronto')::date;
  -- Match website reconciliation: bill confirmed/played/replacement once;
  -- preserve existing amounts/waivers and remove only non-billable charges.
  for v_a in select * from public.attendance where session_id=p_session_id for update loop
    if v_a.status not in ('confirmed','played','replacement') then
      select * into v_charge from public.session_player_charges where session_id=p_session_id and player_id=v_a.player_id for update;
      if found then
        if v_charge.ledger_entry_id is not null and not exists(select 1 from public.ledger_entries where id=v_charge.ledger_entry_id
          and type='session_used' and session_id=p_session_id and player_id=v_a.player_id)
          then raise exception 'Charge ledger mismatch; administrator review required'; end if;
        delete from public.session_player_charges where id=v_charge.id;
        delete from public.ledger_entries where id=v_charge.ledger_entry_id;
        v_removed:=v_removed+1;
      end if;
    else
      if v_completed and v_a.status='confirmed' then
        update public.attendance set status='played' where id=v_a.id;
        v_changed:=v_changed+1;
      end if;
      v_charge_id:=null;
      insert into public.session_player_charges(organization_id,program_id,season_id,session_id,player_id,amount,original_amount,waiver_amount,sessions_count,source,created_by)
        values(v_session.organization_id,p_program_id,v_season,p_session_id,v_a.player_id,v_price,v_price,0,1,
          case when p_action='complete' then 'session_completed' else 'manual' end,auth.uid())
        on conflict(session_id,player_id) do nothing returning id into v_charge_id;
      if v_charge_id is not null then
        insert into public.ledger_entries(organization_id,program_id,season_id,session_id,player_id,type,amount,sessions_count,description,created_by)
          values(v_session.organization_id,p_program_id,v_season,p_session_id,v_a.player_id,'session_used',v_price,1,
            case when p_action='complete' then 'Session completed' else 'Manual attendance update' end || '. Status: ' || case when v_a.status='confirmed' then 'played' else v_a.status end || '.',auth.uid())
          returning id into v_ledger_id;
        update public.session_player_charges set ledger_entry_id=v_ledger_id where id=v_charge_id;
        v_new:=v_new+1;
      end if;
    end if;
  end loop;
  if p_action='complete' then update public.sessions set status='completed' where id=p_session_id; end if;
  v_result:=jsonb_build_object('chargedPlayers',v_new,'removedCharges',v_removed,'confirmedChangedToPlayed',v_changed);
  insert into public.audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,old_data,new_data)
    values(p_submission_id,v_session.organization_id,auth.uid(),'mobile_session_operation','sessions',p_session_id,
      jsonb_build_object('sessionStatus',v_session.status,'attendance',to_jsonb(v_old)),jsonb_build_object('payload',v_payload,'result',v_result));
  return v_result;
end;
$$;
revoke all on function public.mobile_session_roster(uuid,uuid,integer,text),public.mobile_session_operation(uuid,uuid,text,uuid,jsonb) from public,anon;
grant execute on function public.mobile_session_roster(uuid,uuid,integer,text),public.mobile_session_operation(uuid,uuid,text,uuid,jsonb) to authenticated;


-- SOURCE: 095_mobile_session_planning.sql
-- Native adapters for existing session planning. No historical rows are changed.
create or replace function public.mobile_session_planning(p_program_id uuid,p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if not public.mobile_program_access(p_program_id) or public.program_role(p_program_id) not in ('manager','captain')
    or not public.is_program_module_enabled(p_program_id,'teams') then raise exception 'Team planning access required'; end if;
  if not exists(select 1 from public.sessions where id=p_session_id and program_id=p_program_id) then raise exception 'Session not found in this program'; end if;
  return public.public_session_team_builder(p_session_id);
end;
$$;

create or replace function public.mobile_generate_fixture(
  p_program_id uuid,p_session_id uuid,p_submission_id uuid,p_repeats integer,
  p_first_minutes integer,p_second_minutes integer,p_break_after integer,p_break_minutes integer,p_avoid_team uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  s public.sessions%rowtype; previous public.audit_logs%rowtype; payload jsonb; result jsonb;
  ids uuid[]; pairs jsonb:='[]'; pair jsonb; preferred jsonb; home uuid; away uuid;
  i integer; j integer; r integer; n integer:=0; cursor_minutes integer; duration integer; starts time; ends time;
begin
  if not public.mobile_program_access(p_program_id) or public.program_role(p_program_id) not in ('manager','captain')
    or not public.is_program_module_enabled(p_program_id,'fixtures') then raise exception 'Fixture access required'; end if;
  if p_submission_id is null or p_repeats is null or p_repeats not between 1 and 20
    or p_first_minutes is null or p_first_minutes not between 1 and 180
    or p_second_minutes is null or p_second_minutes not between 1 and 180
    or p_break_after is null or p_break_after not between 0 and 1000
    or p_break_minutes is null or p_break_minutes not between 0 and 180 then raise exception 'Invalid fixture settings'; end if;
  payload:=jsonb_build_array(p_program_id,p_session_id,p_repeats,p_first_minutes,p_second_minutes,p_break_after,p_break_minutes,p_avoid_team);
  perform pg_advisory_xact_lock(hashtextextended(p_submission_id::text,0));
  select * into previous from public.audit_logs where id=p_submission_id;
  if found then
    if previous.actor_id=auth.uid() and previous.action='mobile_generate_fixture' and previous.new_data->'payload'=payload then return previous.new_data->'result'; end if;
    raise exception 'Submission ID already used';
  end if;
  select * into s from public.sessions where id=p_session_id and program_id=p_program_id for update;
  if not found then raise exception 'Session not found in this program'; end if;
  if s.status<>'scheduled' then raise exception 'Only scheduled sessions can generate fixtures'; end if;
  perform 1 from public.session_matches where session_id=s.id for update;
  if exists(select 1 from public.session_matches where session_id=s.id and result_status='played')
    or exists(select 1 from public.goals where session_id=s.id) then raise exception 'Fixture cannot be regenerated after scores have been saved'; end if;
  select array_agg(id order by name,id) into ids from public.session_teams where session_id=s.id;
  if coalesce(cardinality(ids),0)<2 or cardinality(ids)>12 then raise exception 'Choose between two and twelve teams'; end if;
  if p_avoid_team is not null and not (p_avoid_team=any(ids)) then raise exception 'Unknown team'; end if;
  for i in 1..cardinality(ids)-1 loop
    for j in i+1..cardinality(ids) loop
      pair:=jsonb_build_array(ids[i],ids[j]);
      if preferred is null and p_avoid_team is not null and ids[i]<>p_avoid_team and ids[j]<>p_avoid_team then preferred:=pair;
      else pairs:=pairs||jsonb_build_array(pair); end if;
    end loop;
  end loop;
  if preferred is not null then pairs:=jsonb_build_array(preferred)||pairs; end if;
  if jsonb_array_length(pairs)*p_repeats>1000 then raise exception 'Too many games'; end if;
  cursor_minutes:=extract(hour from s.start_time)::integer*60+extract(minute from s.start_time)::integer;
  delete from public.session_matches where session_id=s.id;
  for r in 0..p_repeats-1 loop
    for pair in select value from jsonb_array_elements(pairs) loop
      home:=(pair->>(r%2))::uuid; away:=(pair->>(1-r%2))::uuid;
      if p_break_after>0 and n=p_break_after then cursor_minutes:=cursor_minutes+p_break_minutes; end if;
      duration:=case when p_break_after>0 and n>=p_break_after then p_second_minutes else p_first_minutes end;
      starts:=(time '00:00'+make_interval(mins=>cursor_minutes))::time;
      cursor_minutes:=cursor_minutes+duration;
      ends:=(time '00:00'+make_interval(mins=>cursor_minutes))::time;
      n:=n+1;
      insert into public.session_matches(organization_id,program_id,session_id,match_number,display_order,team_a_id,team_b_id,away_team_id,
        scheduled_start_time,scheduled_end_time,result_status,team_a_score,team_b_score,created_by)
      values(s.organization_id,p_program_id,s.id,n,n,home,away,away,starts,ends,'scheduled',0,0,auth.uid());
    end loop;
  end loop;
  result:=jsonb_build_object('games',n);
  insert into public.audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,new_data)
    values(p_submission_id,s.organization_id,auth.uid(),'mobile_generate_fixture','sessions',s.id,jsonb_build_object('payload',payload,'result',result));
  return result;
end;
$$;
revoke all on function public.mobile_session_planning(uuid,uuid),public.mobile_generate_fixture(uuid,uuid,uuid,integer,integer,integer,integer,integer,uuid) from public,anon;
grant execute on function public.mobile_session_planning(uuid,uuid),public.mobile_generate_fixture(uuid,uuid,uuid,integer,integer,integer,integer,integer,uuid) to authenticated;


revoke all on function public.public_player_report() from public,anon,authenticated;

revoke all on function public.public_latest_session_winner(uuid) from public,anon,authenticated;

revoke execute on function public.admin_club_transfer_summary(p_season_id uuid) from public,anon,authenticated,service_role;

grant execute on function public.admin_club_transfer_summary(p_season_id uuid) to authenticated,service_role;

revoke execute on function public.admin_dashboard_season_finance(p_season_id uuid) from public,anon,authenticated,service_role;

grant execute on function public.admin_dashboard_season_finance(p_season_id uuid) to authenticated,service_role;

revoke execute on function public.admin_total_player_credit_remaining(p_program_id uuid) from public,anon,authenticated,service_role;

grant execute on function public.admin_total_player_credit_remaining(p_program_id uuid) to anon,authenticated,service_role;

revoke execute on function public.assign_club_expense_season(p_expense_id uuid, p_season_id uuid) from public,anon,authenticated,service_role;

grant execute on function public.assign_club_expense_season(p_expense_id uuid, p_season_id uuid) to authenticated,service_role;

revoke execute on function public.can_access_program(p_program_id uuid) from public,anon,authenticated,service_role;

grant execute on function public.can_access_program(p_program_id uuid) to authenticated,service_role;

revoke execute on function public.can_manage_program_finance(p_program_id uuid, p_module text) from public,anon,authenticated,service_role;

grant execute on function public.can_manage_program_finance(p_program_id uuid, p_module text) to authenticated,service_role;

revoke execute on function public.carry_forward_player_balance(p_player_id uuid, p_source_season_id uuid, p_destination_season_id uuid, p_amount numeric, p_transfer_date date, p_note text, p_submission_id uuid, p_transfer_kind text) from public,anon,authenticated,service_role;

grant execute on function public.carry_forward_player_balance(p_player_id uuid, p_source_season_id uuid, p_destination_season_id uuid, p_amount numeric, p_transfer_date date, p_note text, p_submission_id uuid, p_transfer_kind text) to authenticated,service_role;

revoke execute on function public.carry_forward_player_credit(p_player_id uuid, p_source_season_id uuid, p_destination_season_id uuid, p_amount numeric, p_transfer_date date, p_note text, p_submission_id uuid) from public,anon,authenticated,service_role;

grant execute on function public.carry_forward_player_credit(p_player_id uuid, p_source_season_id uuid, p_destination_season_id uuid, p_amount numeric, p_transfer_date date, p_note text, p_submission_id uuid) to authenticated,service_role;

revoke execute on function public.derive_season_program_scope() from public,anon,authenticated,service_role;

grant execute on function public.derive_season_program_scope() to anon,authenticated,service_role;

revoke execute on function public.mobile_context() from public,anon,authenticated,service_role;

grant execute on function public.mobile_context() to authenticated,service_role;

revoke execute on function public.mobile_create_record(p_program_id uuid, p_kind text, p_id uuid, p_data jsonb) from public,anon,authenticated,service_role;

grant execute on function public.mobile_create_record(p_program_id uuid, p_kind text, p_id uuid, p_data jsonb) to authenticated,service_role;

revoke execute on function public.mobile_credit_preview(p_program_id uuid, p_season_id uuid, p_player_id uuid) from public,anon,authenticated,service_role;

grant execute on function public.mobile_credit_preview(p_program_id uuid, p_season_id uuid, p_player_id uuid) to authenticated,service_role;

revoke execute on function public.mobile_generate_fixture(p_program_id uuid, p_session_id uuid, p_submission_id uuid, p_repeats integer, p_first_minutes integer, p_second_minutes integer, p_break_after integer, p_break_minutes integer, p_avoid_team uuid) from public,anon,authenticated,service_role;

grant execute on function public.mobile_generate_fixture(p_program_id uuid, p_session_id uuid, p_submission_id uuid, p_repeats integer, p_first_minutes integer, p_second_minutes integer, p_break_after integer, p_break_minutes integer, p_avoid_team uuid) to authenticated,service_role;

revoke execute on function public.mobile_list(p_program_id uuid, p_resource text, p_offset integer) from public,anon,authenticated,service_role;

grant execute on function public.mobile_list(p_program_id uuid, p_resource text, p_offset integer) to authenticated,service_role;

revoke execute on function public.mobile_member(p_program_id uuid, p_member_id uuid) from public,anon,authenticated,service_role;

grant execute on function public.mobile_member(p_program_id uuid, p_member_id uuid) to authenticated,service_role;

revoke execute on function public.mobile_program_access(p_program_id uuid) from public,anon,authenticated,service_role;

grant execute on function public.mobile_program_access(p_program_id uuid) to authenticated,service_role;

revoke execute on function public.mobile_record_finance(p_program_id uuid, p_kind text, p_submission_id uuid, p_data jsonb) from public,anon,authenticated,service_role;

grant execute on function public.mobile_record_finance(p_program_id uuid, p_kind text, p_submission_id uuid, p_data jsonb) to authenticated,service_role;

revoke execute on function public.mobile_save_scores(p_program_id uuid, p_session_id uuid, p_games jsonb) from public,anon,authenticated,service_role;

grant execute on function public.mobile_save_scores(p_program_id uuid, p_session_id uuid, p_games jsonb) to authenticated,service_role;

revoke execute on function public.mobile_session(p_program_id uuid, p_session_id uuid) from public,anon,authenticated,service_role;

grant execute on function public.mobile_session(p_program_id uuid, p_session_id uuid) to authenticated,service_role;

revoke execute on function public.mobile_session_operation(p_program_id uuid, p_session_id uuid, p_action text, p_submission_id uuid, p_data jsonb) from public,anon,authenticated,service_role;

grant execute on function public.mobile_session_operation(p_program_id uuid, p_session_id uuid, p_action text, p_submission_id uuid, p_data jsonb) to authenticated,service_role;

revoke execute on function public.mobile_session_planning(p_program_id uuid, p_session_id uuid) from public,anon,authenticated,service_role;

grant execute on function public.mobile_session_planning(p_program_id uuid, p_session_id uuid) to authenticated,service_role;

revoke execute on function public.mobile_session_roster(p_program_id uuid, p_session_id uuid, p_offset integer, p_query text) from public,anon,authenticated,service_role;

grant execute on function public.mobile_session_roster(p_program_id uuid, p_session_id uuid, p_offset integer, p_query text) to authenticated,service_role;

revoke execute on function public.mobile_update_member(p_program_id uuid, p_member_id uuid, p_role text, p_status text, p_approve_organization boolean) from public,anon,authenticated,service_role;

grant execute on function public.mobile_update_member(p_program_id uuid, p_member_id uuid, p_role text, p_status text, p_approve_organization boolean) to authenticated,service_role;

revoke execute on function public.public_game_score_editor(p_session_id uuid) from public,anon,authenticated,service_role;

grant execute on function public.public_game_score_editor(p_session_id uuid) to service_role;

revoke execute on function public.public_latest_winning_streaks(p_season_id uuid) from public,anon,authenticated,service_role;

grant execute on function public.public_latest_winning_streaks(p_season_id uuid) to service_role;

revoke execute on function public.public_longest_winning_streaks(p_season_id uuid) from public,anon,authenticated,service_role;

grant execute on function public.public_longest_winning_streaks(p_season_id uuid) to service_role;

revoke execute on function public.public_payment_notification_keys() from public,anon,authenticated,service_role;

grant execute on function public.public_payment_notification_keys() to service_role;

revoke execute on function public.public_player_report() from public,anon,authenticated,service_role;

grant execute on function public.public_player_report() to service_role;

revoke execute on function public.public_report_season(p_organization_slug text, p_program_slug text) from public,anon,authenticated,service_role;

grant execute on function public.public_report_season(p_organization_slug text, p_program_slug text) to anon,authenticated,service_role;

revoke execute on function public.public_save_game_scores(p_session_id uuid, p_games jsonb) from public,anon,authenticated,service_role;

grant execute on function public.public_save_game_scores(p_session_id uuid, p_games jsonb) to service_role;

revoke execute on function public.public_session_detail(p_session_id uuid) from public,anon,authenticated,service_role;

grant execute on function public.public_session_detail(p_session_id uuid) to service_role;

revoke execute on function public.record_club_balance_transfer(p_source_season_id uuid, p_destination_season_id uuid, p_amount numeric, p_transfer_date date, p_note text, p_submission_id uuid) from public,anon,authenticated,service_role;

grant execute on function public.record_club_balance_transfer(p_source_season_id uuid, p_destination_season_id uuid, p_amount numeric, p_transfer_date date, p_note text, p_submission_id uuid) to authenticated,service_role;

revoke execute on function public.record_player_refund(p_player_id uuid, p_season_id uuid, p_amount numeric, p_refund_date date, p_method text, p_reference text, p_submission_id uuid) from public,anon,authenticated,service_role;

grant execute on function public.record_player_refund(p_player_id uuid, p_season_id uuid, p_amount numeric, p_refund_date date, p_method text, p_reference text, p_submission_id uuid) to authenticated,service_role;

revoke execute on function public.request_development_refresh(p_organization_id uuid, p_job_id uuid, p_command text) from public,anon,authenticated,service_role;

grant execute on function public.request_development_refresh(p_organization_id uuid, p_job_id uuid, p_command text) to authenticated,service_role;

revoke execute on function public.reverse_club_balance_transfer(p_transfer_id uuid, p_submission_id uuid) from public,anon,authenticated,service_role;

grant execute on function public.reverse_club_balance_transfer(p_transfer_id uuid, p_submission_id uuid) to authenticated,service_role;

revoke execute on function public.scoped_public_longest_winning_streaks(p_organization_slug text, p_program_slug text, p_season_id uuid) from public,anon,authenticated,service_role;

grant execute on function public.scoped_public_longest_winning_streaks(p_organization_slug text, p_program_slug text, p_season_id uuid) to anon,authenticated,service_role;

revoke execute on function public.scoped_public_payment_notification_keys(p_organization_slug text, p_program_slug text) from public,anon,authenticated,service_role;

grant execute on function public.scoped_public_payment_notification_keys(p_organization_slug text, p_program_slug text) to anon,authenticated,service_role;

revoke execute on function public.scoped_submit_payment_sent_notification(p_organization_slug text, p_program_slug text, p_player_id uuid, p_season_id uuid) from public,anon,authenticated,service_role;

grant execute on function public.scoped_submit_payment_sent_notification(p_organization_slug text, p_program_slug text, p_player_id uuid, p_season_id uuid) to anon,authenticated,service_role;

revoke execute on function public.set_my_photo(p_path text) from public,anon,authenticated,service_role;

grant execute on function public.set_my_photo(p_path text) to authenticated,service_role;

revoke execute on function public.submit_payment_sent_notification(p_player_id uuid, p_season_id uuid) from public,anon,authenticated,service_role;

grant execute on function public.submit_payment_sent_notification(p_player_id uuid, p_season_id uuid) to service_role;

revoke execute on function public.transfer_player_credit(p_funding_player_id uuid, p_recipient_player_id uuid, p_season_id uuid, p_amount numeric, p_transfer_date date, p_session_id uuid, p_note text, p_submission_id uuid) from public,anon,authenticated,service_role;

grant execute on function public.transfer_player_credit(p_funding_player_id uuid, p_recipient_player_id uuid, p_season_id uuid, p_amount numeric, p_transfer_date date, p_session_id uuid, p_note text, p_submission_id uuid) to authenticated,service_role;