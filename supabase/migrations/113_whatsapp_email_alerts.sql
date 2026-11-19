-- Alerts are opt-in. Provider credentials live only in Edge Function secrets.
create table public.message_alert_settings (
  organization_id uuid primary key references public.organizations(id),
  recipient text not null check(length(recipient)<=254 and recipient ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  enabled boolean not null default false,
  test_succeeded_at timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);
create table public.message_alert_incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  worker_id uuid not null references public.message_worker_connections(id),
  category text not null check(category in ('connection','compatibility','coordinate','commands','group_sync','dispatch','journal_recovery','browser_suspend','startup','pairing_port','worker_overdue','delivery_failed','delivery_unknown','delivery_missed')),
  execution_id uuid references public.message_executions(id),
  opened_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz
);
create unique index message_alert_open_incident on public.message_alert_incidents(worker_id,category,coalesce(execution_id,'00000000-0000-0000-0000-000000000000'::uuid)) where resolved_at is null;
create table public.message_alert_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  incident_id uuid references public.message_alert_incidents(id),
  kind text not null check(kind in ('failure','recovery','test')),
  recipient text not null,
  -- Immutable safe payload makes provider idempotency safe across retries and configuration changes.
  payload jsonb not null,
  status text not null default 'pending' check(status in ('pending','sending','sent','failed','cancelled')),
  attempts integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  next_attempt_at timestamptz not null default clock_timestamp(),
  claimed_at timestamptz, claim_id uuid, sent_at timestamptz, provider_id text, error_code text,
  unique(incident_id,kind)
);
create index message_alert_outbox_due on public.message_alert_outbox(next_attempt_at) where status in ('pending','sending');
alter table public.message_alert_settings enable row level security;
alter table public.message_alert_incidents enable row level security;
alter table public.message_alert_outbox enable row level security;
revoke all on public.message_alert_settings,public.message_alert_incidents,public.message_alert_outbox from anon,authenticated;

alter table public.message_worker_connections add column state_changed_at timestamptz not null default clock_timestamp();
create function public.message_worker_state_changed() returns trigger language plpgsql set search_path=public as $$
begin
  if new.state is distinct from old.state then new.state_changed_at:=clock_timestamp(); end if;
  return new;
end $$;
create trigger message_worker_state_changed before update of state on public.message_worker_connections for each row execute function public.message_worker_state_changed();

create function public.message_alert_transition(p_worker_id uuid,p_category text,p_failed boolean,p_execution_id uuid default null) returns void
language plpgsql security definer set search_path=public as $$
declare c public.message_worker_connections%rowtype; s public.message_alert_settings%rowtype; incident public.message_alert_incidents%rowtype; kind text;
begin
  select * into c from public.message_worker_connections where id=p_worker_id;
  -- Serialize transitions with settings changes and concurrent monitors.
  select * into s from public.message_alert_settings where organization_id=c.organization_id for update;
  if s.organization_id is null or not s.enabled then return; end if;
  if p_execution_id is not null and not exists(select 1 from public.message_executions where id=p_execution_id and organization_id=c.organization_id) then raise exception 'Invalid alert execution'; end if;
  select * into incident from public.message_alert_incidents where worker_id=c.id and category=p_category and execution_id is not distinct from p_execution_id and resolved_at is null;
  if p_failed then
    if incident.id is not null then return; end if;
    insert into public.message_alert_incidents(organization_id,worker_id,category,execution_id) values(c.organization_id,c.id,p_category,p_execution_id) returning * into incident;
    kind:='failure';
  else
    if incident.id is null then return; end if;
    update public.message_alert_incidents set resolved_at=clock_timestamp() where id=incident.id;
    kind:='recovery';
  end if;
  insert into public.message_alert_outbox(organization_id,incident_id,kind,recipient,payload)
  values(c.organization_id,incident.id,kind,s.recipient,jsonb_build_object('organization_id',c.organization_id,'worker_id',c.id,'category',p_category,'execution_id',p_execution_id,'at',clock_timestamp()));
end $$;

create function public.message_alert_admin(p_organization_id uuid,p_operation text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare s public.message_alert_settings%rowtype; email text; delivery uuid;
begin
  if auth.uid() is null or public.organization_role(p_organization_id) is distinct from 'admin' then raise exception 'Organization administrator required'; end if;
  if p_operation='save' then
    email:=lower(trim(p_data->>'recipient'));
    insert into public.message_alert_settings(organization_id,recipient) values(p_organization_id,email)
    on conflict(organization_id) do update set recipient=excluded.recipient,
      enabled=case when message_alert_settings.recipient=excluded.recipient then message_alert_settings.enabled else false end,
      test_succeeded_at=case when message_alert_settings.recipient=excluded.recipient then message_alert_settings.test_succeeded_at else null end,updated_at=clock_timestamp();
    update public.message_alert_outbox set status='cancelled' where organization_id=p_organization_id and recipient<>email and status in ('pending','sending');
    update public.message_alert_incidents set resolved_at=clock_timestamp() where organization_id=p_organization_id and resolved_at is null and not exists(select 1 from public.message_alert_settings where organization_id=p_organization_id and enabled);
  elsif p_operation='enable' then
    select * into s from public.message_alert_settings where organization_id=p_organization_id for update;
    if s.organization_id is null then raise exception 'Save an alert recipient first'; end if;
    if coalesce((p_data->>'enabled')::boolean,false) and s.test_succeeded_at is null then raise exception 'Send a successful test email first'; end if;
    update public.message_alert_settings set enabled=coalesce((p_data->>'enabled')::boolean,false),updated_at=clock_timestamp() where organization_id=p_organization_id;
    if not coalesce((p_data->>'enabled')::boolean,false) then
      update public.message_alert_outbox set status='cancelled' where organization_id=p_organization_id and kind<>'test' and status in ('pending','sending');
      update public.message_alert_incidents set resolved_at=clock_timestamp() where organization_id=p_organization_id and resolved_at is null;
    end if;
  elsif p_operation='test' then
    select * into s from public.message_alert_settings where organization_id=p_organization_id for update;
    if s.organization_id is null then raise exception 'Save an alert recipient first'; end if;
    if exists(select 1 from public.message_alert_outbox where organization_id=p_organization_id and kind='test' and created_at>clock_timestamp()-interval '1 minute') then raise exception 'Wait one minute before another test'; end if;
    insert into public.message_alert_outbox(organization_id,kind,recipient,payload) values(p_organization_id,'test',s.recipient,jsonb_build_object('organization_id',p_organization_id,'at',clock_timestamp())) returning id into delivery;
    return jsonb_build_object('id',delivery);
  elsif p_operation<>'status' then raise exception 'Unknown alert operation'; end if;
  select * into s from public.message_alert_settings where organization_id=p_organization_id;
  return jsonb_build_object('settings',case when s.organization_id is null then null else to_jsonb(s) end,
    'deliveries',coalesce((select jsonb_agg(x) from (select id,kind,status,created_at,sent_at,error_code from public.message_alert_outbox where organization_id=p_organization_id order by created_at desc limit 10)x),'[]'),
    'open_incidents',coalesce((select jsonb_agg(x) from (select category,execution_id,opened_at from public.message_alert_incidents where organization_id=p_organization_id and resolved_at is null)x),'[]'));
end $$;

-- Only the Edge Function calls this RPC. The worker token is checked even with a service client.
create function public.message_alert_report(p_worker_id uuid,p_token text,p_events jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c public.message_worker_connections%rowtype; event jsonb;
begin
  select * into c from public.message_worker_connections where id=p_worker_id;
  if c.id is null or c.token_hash is distinct from encode(extensions.digest(p_token,'sha256'),'hex') then raise exception 'Invalid worker credential'; end if;
  if jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)>30 then raise exception 'Invalid alert events'; end if;
  for event in select * from jsonb_array_elements(p_events) loop
    if coalesce(event->>'category','') not in ('connection','compatibility','coordinate','commands','group_sync','dispatch','journal_recovery','browser_suspend','startup','pairing_port') then raise exception 'Invalid alert category'; end if;
    if jsonb_typeof(event->'failed') is distinct from 'boolean' then raise exception 'Invalid alert state'; end if;
    perform public.message_alert_transition(c.id,event->>'category',(event->>'failed')::boolean);
  end loop;
  return jsonb_build_object('organization_id',c.organization_id,'enabled',coalesce((select enabled from public.message_alert_settings where organization_id=c.organization_id),false));
end $$;

create function public.message_alert_monitor(p_organization_id uuid default null) returns void
language plpgsql security definer set search_path=public as $$
declare c public.message_worker_connections%rowtype; e record; overdue boolean; bad_connection boolean;
begin
  for c in select w.* from public.message_worker_connections w join public.message_alert_settings s on s.organization_id=w.organization_id and s.enabled where p_organization_id is null or w.organization_id=p_organization_id loop
    overdue:=case when c.worker_mode='idle' then c.next_check_at is null or c.next_check_at<clock_timestamp()-interval '5 minutes'
      else c.heartbeat_at is null or c.heartbeat_at<clock_timestamp()-make_interval(secs=>3*c.heartbeat_interval_seconds) end;
    perform public.message_alert_transition(c.id,'worker_overdue',overdue);
    if not overdue and c.worker_mode<>'idle' and c.state not in ('logged_out','offline') then
      bad_connection:=c.state in ('disconnected','auth_failure') or (c.state in ('starting','qr_required') and c.state_changed_at<clock_timestamp()-interval '2 minutes');
      if bad_connection or (c.state='ready' and not exists(select 1 from public.message_alert_incidents where worker_id=c.id and category='connection' and resolved_at is null and opened_at>c.heartbeat_at)) then perform public.message_alert_transition(c.id,'connection',bad_connection); end if;
    end if;
    for e in select id,status from public.message_executions where organization_id=c.organization_id and phase='complete' and (scheduled_at>clock_timestamp()-interval '24 hours' or id in (select execution_id from public.message_alert_incidents where worker_id=c.id and resolved_at is null)) and status in ('failed','unknown','missed','sent') loop
      if e.status<>'sent' then
        perform public.message_alert_transition(c.id,'delivery_'||case when e.status='unknown' then 'unknown' when e.status='missed' then 'missed' else 'failed' end,true,e.id);
      else
        perform public.message_alert_transition(c.id,'delivery_unknown',false,e.id);
      end if;
    end loop;
  end loop;
end $$;

create function public.message_alert_claim(p_organization_id uuid default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  -- Never retry outside the provider's 24-hour idempotency window.
  update public.message_alert_outbox set status='failed',error_code='retry_exhausted' where (p_organization_id is null or organization_id=p_organization_id) and status in ('pending','sending') and (attempts>=5 and coalesce(claimed_at,created_at)<clock_timestamp()-interval '2 minutes' or created_at<clock_timestamp()-interval '23 hours');
  with picked as (
    select o.id from public.message_alert_outbox o join public.message_alert_settings s on s.organization_id=o.organization_id and s.recipient=o.recipient
    where (p_organization_id is null or o.organization_id=p_organization_id) and (s.enabled or o.kind='test')
    and o.attempts<5 and ((o.status='pending' and o.next_attempt_at<=clock_timestamp()) or (o.status='sending' and o.claimed_at<clock_timestamp()-interval '2 minutes'))
    and (o.kind<>'recovery' or exists(select 1 from public.message_alert_outbox f where f.incident_id=o.incident_id and f.kind='failure' and f.status='sent'))
    order by o.created_at limit 10 for update of o skip locked
  ), claimed as (
    update public.message_alert_outbox set status='sending',attempts=attempts+1,claimed_at=clock_timestamp(),claim_id=gen_random_uuid() where id in(select id from picked) returning *
  ) select coalesce(jsonb_agg(claimed),'[]') into result from claimed;
  return result;
end $$;

create function public.message_alert_complete(p_id uuid,p_claim_id uuid,p_provider_id text default null,p_error_code text default null) returns void
language plpgsql security definer set search_path=public as $$
declare item public.message_alert_outbox%rowtype;
begin
  select * into item from public.message_alert_outbox where id=p_id and claim_id=p_claim_id and status='sending' for update;
  if item.id is null then return; end if;
  if p_provider_id is not null then
    update public.message_alert_outbox set status='sent',sent_at=clock_timestamp(),provider_id=left(p_provider_id,100),error_code=null where id=item.id;
    if item.kind='test' then update public.message_alert_settings set test_succeeded_at=clock_timestamp() where organization_id=item.organization_id and recipient=item.recipient; end if;
  else
    update public.message_alert_outbox set status=case when attempts>=5 then 'failed' else 'pending' end,error_code=case when p_error_code ~ '^[a-z0-9_]{1,40}$' then p_error_code else 'delivery_failed' end,
      next_attempt_at=clock_timestamp()+make_interval(secs=>case attempts when 1 then 5 when 2 then 30 when 3 then 120 else 600 end) where id=item.id;
  end if;
end $$;

revoke all on function public.message_alert_transition(uuid,text,boolean,uuid),public.message_alert_report(uuid,text,jsonb),public.message_alert_monitor(uuid),public.message_alert_claim(uuid),public.message_alert_complete(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.message_alert_report(uuid,text,jsonb),public.message_alert_monitor(uuid),public.message_alert_claim(uuid),public.message_alert_complete(uuid,uuid,text,text) to service_role;
revoke all on function public.message_alert_admin(uuid,text,jsonb) from public,anon;
grant execute on function public.message_alert_admin(uuid,text,jsonb) to authenticated;

-- Enqueue authoritative delivery outcomes in the result transaction; never send from a trigger.
create function public.message_alert_execution_changed() returns trigger language plpgsql security definer set search_path=public as $$
declare worker uuid;
begin
  if new.phase<>'complete' then return new; end if;
  select id into worker from public.message_worker_connections where organization_id=new.organization_id;
  if worker is null then return new; end if;
  if new.status in ('failed','unknown','missed') then
    perform public.message_alert_transition(worker,'delivery_'||case when new.status='unknown' then 'unknown' when new.status='missed' then 'missed' else 'failed' end,true,new.id);
  elsif new.status='sent' then perform public.message_alert_transition(worker,'delivery_unknown',false,new.id); end if;
  return new;
end $$;
create trigger message_alert_execution_changed after insert or update of status,phase on public.message_executions for each row execute function public.message_alert_execution_changed();

alter table public.message_alert_outbox add column email_payload jsonb;
create function public.message_alert_prepare(p_id uuid,p_claim_id uuid,p_email jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  update public.message_alert_outbox set email_payload=coalesce(email_payload,p_email) where id=p_id and claim_id=p_claim_id and status='sending' returning email_payload into result;
  return result;
end $$;
revoke all on function public.message_alert_prepare(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.message_alert_prepare(uuid,uuid,jsonb) to service_role;

create or replace function public.message_worker_coordinate(p_worker_id uuid,p_token text,p_instance_id uuid,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.message_worker_connections%rowtype; commands jsonb; configuration jsonb; executions jsonb; config_version text; work_version text; idle boolean:=coalesce(p_data->>'mode','active')='idle'; next_check timestamptz;
begin
  if coalesce((p_data->>'release')::boolean,false) then
    select * into c from public.message_worker_connections where id=p_worker_id for update;
    if c.id is null or c.token_hash is distinct from encode(extensions.digest(p_token,'sha256'),'hex') then raise exception 'Invalid worker credential'; end if;
    if p_instance_id is null or c.instance_id is distinct from p_instance_id then raise exception 'Worker lease lost'; end if;
    update public.message_worker_connections set lease_until=clock_timestamp(),state='offline',worker_mode='active',next_check_at=null,heartbeat_interval_seconds=10 where id=c.id;
    return '{}';
  end if;
  select * into c from public.message_worker_connections where id=p_worker_id for update;
  if c.id is null or c.token_hash is distinct from encode(extensions.digest(p_token,'sha256'),'hex') then raise exception 'Invalid worker credential'; end if;
  if p_instance_id is null then raise exception 'Worker instance required'; end if;
  if c.lease_until>clock_timestamp() and c.instance_id is distinct from p_instance_id then raise exception 'Worker already active'; end if;
  if c.instance_id is distinct from p_instance_id then
    c.fence:=c.fence+1;
    update public.message_worker_commands set status='pending' where organization_id=c.organization_id and status='claimed' and expires_at>clock_timestamp();
    update public.message_executions set status=case when phase='dispatching' then 'unknown' else 'pending' end,
      phase=case when phase='dispatching' then 'complete' else 'queued' end,
      error=case when phase='dispatching' then 'Worker interrupted; delivery uncertain. No automatic retry.' else null end
    where organization_id=c.organization_id and status='pending';
  end if;
  next_check:=least(clock_timestamp()+interval '1 hour',greatest(clock_timestamp(),coalesce((p_data->>'next_check_at')::timestamptz,clock_timestamp()+interval '1 hour')));
  update public.message_worker_connections set instance_id=p_instance_id,fence=c.fence,
    adaptive_coordination=p_data ? 'mode',
    worker_mode=case when idle then 'idle' else 'active' end,
    heartbeat_interval_seconds=case when idle then 3600 else 30 end,
    next_check_at=case when idle then next_check else clock_timestamp()+interval '30 seconds' end,
    acknowledged_configuration_revision=p_data->>'configuration_revision',
    lease_until=clock_timestamp()+case when idle then interval '65 minutes' else interval '90 seconds' end,
    heartbeat_at=clock_timestamp(),last_sync_at=clock_timestamp(),
    state=case when idle then 'idle' else p_data->>'state' end,compatible=coalesce((p_data->>'compatible')::boolean,false)
  where id=p_worker_id returning * into c;
  insert into public.message_worker_heartbeats values(c.organization_id,c.id,c.heartbeat_at,c.state,c.compatible)
  on conflict(organization_id) do update set heartbeat_at=excluded.heartbeat_at,state=excluded.state,compatible=excluded.compatible;
  commands:=public.message_worker(p_worker_id,p_token,p_instance_id,'commands');
  -- Expire old work, including tests, even when the WhatsApp browser is unavailable.
  perform public.message_worker(p_worker_id,p_token,p_instance_id,'due');
  select * into c from public.message_worker_connections where id=p_worker_id;
  config_version:=public.message_configuration_version(c.organization_id);
  work_version:=public.message_work_version(c.organization_id);
  if p_data->>'configuration_revision' is distinct from config_version then
    configuration:=jsonb_build_object(
      'schedules',coalesce((select jsonb_agg(s) from public.message_schedules s where s.organization_id=c.organization_id and s.enabled and s.deleted_at is null),'[]'),
      'destinations',coalesce((select jsonb_agg(d) from public.message_destinations d where d.organization_id=c.organization_id and d.available),'[]'));
  end if;
  if p_data->>'work_revision' is distinct from work_version then
    select coalesce(jsonb_agg(e order by e.scheduled_at),'[]') into executions from public.message_executions e
    where e.organization_id=c.organization_id and e.status='pending' and e.phase<>'dispatching'
      and e.scheduled_at<=clock_timestamp()+interval '24 hours';
  end if;
  return jsonb_build_object('alert_pending',exists(select 1 from public.message_alert_outbox where organization_id=c.organization_id and status='pending'),'alert_revision',(select updated_at::text from public.message_alert_settings where organization_id=c.organization_id),'adaptive_coordination',true,'configuration_revision',config_version,'work_revision',work_version,
    'configuration',configuration,'executions',executions,'commands',commands,'automatic_enabled',c.automatic_enabled,
    'last_scan_at',coalesce(c.last_scan_at,c.created_at),'fence',c.fence);
end $$;
revoke all on function public.message_worker_coordinate(uuid,text,uuid,jsonb) from public;
grant execute on function public.message_worker_coordinate(uuid,text,uuid,jsonb) to anon,authenticated;



create or replace function public.message_worker_materialize_batch(p_worker_id uuid,p_token text,p_instance_id uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.message_worker_connections%rowtype; item jsonb; executions jsonb;
begin
  select * into c from public.message_worker_connections where id=p_worker_id for update;
  if c.id is null or c.token_hash is distinct from encode(extensions.digest(p_token,'sha256'),'hex') then raise exception 'Invalid worker credential'; end if;
  if p_instance_id is null or c.instance_id is distinct from p_instance_id or c.lease_until is null or c.lease_until<=clock_timestamp() then raise exception 'Worker lease lost'; end if;
  if p_data->>'configuration_revision' is distinct from public.message_configuration_version(c.organization_id) then raise exception 'Configuration changed; synchronize again'; end if;
  update public.message_worker_connections set acknowledged_configuration_revision=p_data->>'configuration_revision',
    next_check_at=case when worker_mode='idle' and p_data ? 'next_check_at' then least(clock_timestamp()+interval '1 hour',greatest(clock_timestamp(),(p_data->>'next_check_at')::timestamptz)) else next_check_at end where id=c.id;
  if jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_array_length(p_data->'items')>1000 then raise exception 'Invalid execution batch'; end if;
  for item in select * from jsonb_array_elements(p_data->'items') loop
    perform public.message_worker(p_worker_id,p_token,p_instance_id,'materialize',item);
  end loop;
  if p_data->>'scanned_at' is not null then
    perform public.message_worker(p_worker_id,p_token,p_instance_id,'scanned',jsonb_build_object('at',p_data->>'scanned_at'));
  end if;
  select * into c from public.message_worker_connections where id=p_worker_id;
  select coalesce(jsonb_agg(e order by e.scheduled_at),'[]') into executions from public.message_executions e
  where e.organization_id=c.organization_id and e.status='pending' and e.phase<>'dispatching'
    and e.scheduled_at<=clock_timestamp()+interval '24 hours';
  return jsonb_build_object('alert_pending',exists(select 1 from public.message_alert_outbox where organization_id=c.organization_id and status='pending'),'executions',executions,'work_revision',public.message_work_version(c.organization_id));
end $$;
revoke all on function public.message_worker_materialize_batch(uuid,text,uuid,jsonb) from public;
grant execute on function public.message_worker_materialize_batch(uuid,text,uuid,jsonb) to anon,authenticated;
