create table if not exists public.payment_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  notification_type text not null default 'payment_sent',
  amount numeric(10,2) not null,
  message text not null,
  read_at timestamptz,
  read_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (notification_type in ('payment_sent')),
  check (amount > 0)
);

create index if not exists payment_notifications_org_read_idx on public.payment_notifications(organization_id, read_at, created_at desc);
create index if not exists payment_notifications_player_season_amount_idx on public.payment_notifications(player_id, season_id, amount);

alter table public.payment_notifications enable row level security;

drop policy if exists "payment_notifications_admin_select" on public.payment_notifications;
create policy "payment_notifications_admin_select" on public.payment_notifications
for select using (public.organization_role(organization_id) = 'admin');

drop policy if exists "payment_notifications_admin_update" on public.payment_notifications;
create policy "payment_notifications_admin_update" on public.payment_notifications
for update using (public.organization_role(organization_id) = 'admin')
with check (public.organization_role(organization_id) = 'admin');

drop policy if exists "payment_notifications_admin_delete" on public.payment_notifications;
create policy "payment_notifications_admin_delete" on public.payment_notifications
for delete using (public.organization_role(organization_id) = 'admin');

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
  select pn.player_id, pn.season_id, pn.amount
  from public.payment_notifications pn
  where pn.notification_type = 'payment_sent';
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

  select pn.id
  into existing_id
  from public.payment_notifications pn
  where pn.notification_type = 'payment_sent'
    and pn.player_id = p_player_id
    and pn.season_id = p_season_id
    and pn.amount = owed_amount
  order by pn.created_at desc
  limit 1;

  if existing_id is not null then
    return jsonb_build_object('success', true, 'duplicate', true, 'id', existing_id, 'amount', owed_amount);
  end if;

  select coalesce(seasons.organization_id, public.current_organization_id()) into org_id
  from public.seasons
  where seasons.id = p_season_id;

  player_name := coalesce(report_row.player_name, 'Player');

  insert into public.payment_notifications(
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
