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
