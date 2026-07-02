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
