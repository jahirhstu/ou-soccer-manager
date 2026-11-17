-- Personal WhatsApp credentials and QR codes never enter this database.
create table public.message_worker_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id),
  token_hash text not null,
  automatic_enabled boolean not null default false,
  compatible boolean not null default false,
  state text not null default 'offline',
  instance_id uuid, fence bigint not null default 0, lease_until timestamptz,
  heartbeat_at timestamptz, last_scan_at timestamptz,
  created_at timestamptz not null default now(),
  unique(id, organization_id)
);
create table public.message_templates (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  name text not null check(length(name) between 1 and 120), body text not null check(length(body) between 1 and 10000),
  created_at timestamptz not null default now(), unique(organization_id,name), unique(id,organization_id)
);
create table public.message_destinations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  group_id text not null check(group_id like '%@g.us'), name text not null, available boolean not null default true,
  unique(organization_id,group_id), unique(id,organization_id)
);
create table public.message_schedules (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  name text not null check(length(name) between 1 and 120), body text not null check(length(body) between 1 and 10000),
  destination_id uuid, frequency text not null check(frequency in ('once','daily','weekly')),
  timezone text not null default 'America/Toronto', local_time time not null default '21:00:00', local_date date,
  weekdays integer[] not null default '{1}', venue text not null default '', match_time text not null default '',
  enabled boolean not null default false, revision integer not null default 1, deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(destination_id,organization_id) references public.message_destinations(id,organization_id),
  check(not enabled or destination_id is not null), check(frequency <> 'once' or local_date is not null),
  check(weekdays <@ array[1,2,3,4,5,6,7] and (frequency <> 'weekly' or cardinality(weekdays)>0)),
  unique(id,organization_id)
);
create unique index message_schedule_names on public.message_schedules(organization_id,name) where deleted_at is null;
create function public.message_schedule_revision() returns trigger language plpgsql set search_path=public as $$
begin
  if not exists(select 1 from pg_timezone_names where name=new.timezone) then raise exception 'Invalid timezone'; end if;
  if TG_OP='UPDATE' then new.revision:=old.revision+1; else new.revision:=1; end if;
  new.updated_at:=clock_timestamp();
  if new.deleted_at is not null then new.enabled:=false; end if;
  return new;
end $$;
create trigger message_schedule_revision before insert or update on public.message_schedules
for each row execute function public.message_schedule_revision();
create table public.message_executions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  schedule_id uuid, schedule_revision integer, scheduled_at timestamptz not null,
  body text not null, group_id text not null check(group_id like '%@g.us'),
  is_test boolean not null default false, expires_at timestamptz,
  status text not null default 'pending' check(status in ('pending','sent','failed','missed','unknown','cancelled')),
  phase text not null default 'queued' check(phase in ('queued','prepared','dispatching','complete')),
  attempt_id uuid, instance_id uuid, fence bigint,
  authorized_at timestamptz, dispatch_at timestamptz, acknowledgement_at timestamptz, latency_ms double precision,
  provider_message_id text, error text, created_at timestamptz not null default now(),
  foreign key(schedule_id,organization_id) references public.message_schedules(id,organization_id),
  unique(schedule_id,scheduled_at)
);
create index message_executions_due on public.message_executions(organization_id,scheduled_at) where status='pending';
create table public.message_worker_heartbeats (
  organization_id uuid primary key references public.organizations(id), worker_id uuid not null references public.message_worker_connections(id),
  heartbeat_at timestamptz not null, state text not null, compatible boolean not null
);
create table public.message_worker_commands (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  command text not null check(command in ('reconnect','disconnect')), status text not null default 'pending' check(status in ('pending','claimed','complete','expired')),
  created_at timestamptz not null default now(), expires_at timestamptz not null default(now()+interval '60 seconds')
);

-- Configuration uses existing organization admin semantics; worker-owned tables are read-only to admins.
do $$ declare t text; begin
  foreach t in array array['message_templates','message_schedules','message_destinations','message_executions','message_worker_connections','message_worker_commands','message_worker_heartbeats'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    if t <> 'message_worker_connections' then
      execute format('grant select on public.%I to authenticated',t);
      execute format('create policy admin_read on public.%I for select to authenticated using(public.organization_role(organization_id) = ''admin'')',t);
    end if;
  end loop;
  foreach t in array array['message_templates','message_schedules'] loop
    execute format('grant insert,update on public.%I to authenticated',t);
    execute format('create policy admin_insert on public.%I for insert to authenticated with check(public.organization_role(organization_id) = ''admin'')',t);
    execute format('create policy admin_update on public.%I for update to authenticated using(public.organization_role(organization_id) = ''admin'') with check(public.organization_role(organization_id) = ''admin'')',t);
  end loop;
end $$;

create function public.message_admin(p_organization_id uuid, p_operation text, p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.message_worker_connections%rowtype; token text; result jsonb; destination public.message_destinations%rowtype;
begin
  if auth.uid() is null or public.organization_role(p_organization_id) is distinct from 'admin' then raise exception 'Organization administrator required'; end if;
  select * into c from public.message_worker_connections where organization_id=p_organization_id for update;
  if p_operation='status' then
    return case when c.id is null then null else to_jsonb(c)-'token_hash'-'instance_id' end;
  elsif p_operation='provision' then
    token:=encode(extensions.gen_random_bytes(32),'hex');
    insert into public.message_worker_connections(organization_id,token_hash) values(p_organization_id,encode(extensions.digest(token,'sha256'),'hex'))
    on conflict(organization_id) do update set token_hash=excluded.token_hash,automatic_enabled=false,compatible=false,lease_until=null,instance_id=null,fence=message_worker_connections.fence+1
    returning * into c;
    return jsonb_build_object('worker_id',c.id,'token',token);
  elsif p_operation='automation' then
    if c.id is null then raise exception 'Provision a worker first'; end if;
    if (p_data->>'enabled')::boolean and (not c.compatible or c.state<>'ready' or c.heartbeat_at is null or c.heartbeat_at<now()-interval '30 seconds') then
      raise exception 'A compatible connected worker is required';
    end if;
    update public.message_worker_connections set automatic_enabled=(p_data->>'enabled')::boolean where id=c.id;
  elsif p_operation in ('reconnect','disconnect') then
    if c.id is null then raise exception 'Provision a worker first'; end if;
    if p_operation='disconnect' then update public.message_worker_connections set automatic_enabled=false where id=c.id; end if;
    insert into public.message_worker_commands(organization_id,command) values(p_organization_id,p_operation);
  elsif p_operation='test' then
    select * into destination from public.message_destinations where id=(p_data->>'destination_id')::uuid and organization_id=p_organization_id and available;
    if destination.id is null or c.id is null or c.state is distinct from 'ready' or not c.compatible or c.heartbeat_at is null or c.heartbeat_at<now()-interval '30 seconds' then raise exception 'Connected worker and available group required'; end if;
    if length(p_data->>'body') not between 1 and 10000 then raise exception 'Invalid message'; end if;
    insert into public.message_executions(organization_id,body,group_id,scheduled_at,is_test,expires_at)
    values(p_organization_id,p_data->>'body',destination.group_id,clock_timestamp(),true,clock_timestamp()+interval '60 seconds');
  else raise exception 'Unknown operation'; end if;
  return '{}'::jsonb;
end $$;
revoke all on function public.message_admin(uuid,text,jsonb) from public,anon;
grant execute on function public.message_admin(uuid,text,jsonb) to authenticated;

-- The credential authorizes only this worker's organization, through this restricted RPC.
create function public.message_worker(p_worker_id uuid,p_token text,p_instance_id uuid,p_operation text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.message_worker_connections%rowtype; e public.message_executions%rowtype; s public.message_schedules%rowtype;
  result jsonb; item jsonb; dest public.message_destinations%rowtype; attempt uuid; stamp timestamptz:=clock_timestamp();
begin
  select * into c from public.message_worker_connections where id=p_worker_id for update;
  stamp:=clock_timestamp();
  if c.id is null or c.token_hash is distinct from encode(extensions.digest(p_token,'sha256'),'hex') then raise exception 'Invalid worker credential'; end if;
  if p_instance_id is null then raise exception 'Worker instance required'; end if;
  if p_operation='heartbeat' then
    if c.lease_until>stamp and c.instance_id is distinct from p_instance_id then raise exception 'Worker already active'; end if;
    if c.instance_id is distinct from p_instance_id then
      c.fence:=c.fence+1;
      update public.message_worker_commands set status='pending' where organization_id=c.organization_id and status='claimed' and expires_at>stamp;
      update public.message_executions set status=case when phase='dispatching' then 'unknown' else 'pending' end,
        phase=case when phase='dispatching' then 'complete' else 'queued' end,
        error=case when phase='dispatching' then 'Worker interrupted; delivery uncertain. No automatic retry.' else null end
      where organization_id=c.organization_id and status='pending';
    end if;
    update public.message_worker_connections set instance_id=p_instance_id,fence=c.fence,lease_until=stamp+interval '30 seconds',
      heartbeat_at=stamp,state=p_data->>'state',compatible=coalesce((p_data->>'compatible')::boolean,false) where id=c.id;
    insert into public.message_worker_heartbeats values(c.organization_id,c.id,stamp,p_data->>'state',coalesce((p_data->>'compatible')::boolean,false))
    on conflict(organization_id) do update set heartbeat_at=excluded.heartbeat_at,state=excluded.state,compatible=excluded.compatible;
    return jsonb_build_object('fence',c.fence);
  end if;
  if c.instance_id is distinct from p_instance_id or c.lease_until<=stamp or c.lease_until is null then raise exception 'Worker lease lost'; end if;
  if p_operation='sync' then
    update public.message_destinations set available=false where organization_id=c.organization_id;
    for item in select * from jsonb_array_elements(p_data->'groups') loop
      insert into public.message_destinations(organization_id,group_id,name) values(c.organization_id,item->>'id',item->>'name')
      on conflict(organization_id,group_id) do update set name=excluded.name,available=true;
    end loop;
    return '{}';
  elsif p_operation='scan' then
    select jsonb_build_object('schedules',coalesce((select jsonb_agg(sch) from public.message_schedules sch where sch.organization_id=c.organization_id and enabled and deleted_at is null),'[]'),
      'destinations',coalesce((select jsonb_agg(d) from public.message_destinations d where d.organization_id=c.organization_id and available),'[]'),
      'last_scan_at',coalesce(c.last_scan_at,c.created_at),'automatic_enabled',c.automatic_enabled) into result;
    return result;
  elsif p_operation='scanned' then
    update public.message_worker_connections set last_scan_at=(p_data->>'at')::timestamptz where id=c.id;
  elsif p_operation='materialize' then
    select * into s from public.message_schedules where id=(p_data->>'schedule_id')::uuid and organization_id=c.organization_id and enabled and deleted_at is null for update;
    if s.id is null or s.revision<>(p_data->>'revision')::integer then return '{}'; end if;
    select * into dest from public.message_destinations where id=s.destination_id and organization_id=c.organization_id;
    insert into public.message_executions(organization_id,schedule_id,schedule_revision,scheduled_at,body,group_id,status,phase,error)
    values(c.organization_id,s.id,s.revision,(p_data->>'scheduled_at')::timestamptz,coalesce(p_data->>'body',''),dest.group_id,
      case when p_data->>'error' is not null then 'failed' when (p_data->>'scheduled_at')::timestamptz<stamp-interval '5 seconds' then 'missed' else 'pending' end,
      case when p_data->>'error' is not null or (p_data->>'scheduled_at')::timestamptz<stamp-interval '5 seconds' then 'complete' else 'queued' end,p_data->>'error')
    on conflict(schedule_id,scheduled_at) do update set schedule_revision=excluded.schedule_revision,body=excluded.body,group_id=excluded.group_id,
      status=excluded.status,phase=excluded.phase,instance_id=null,fence=null,error=excluded.error
    where message_executions.attempt_id is null and (message_executions.status='pending' and message_executions.schedule_revision<>excluded.schedule_revision
      or message_executions.status='cancelled' and excluded.scheduled_at>stamp); 
  elsif p_operation='due' then
    update public.message_executions set status='unknown',phase='complete',error='Dispatch outcome unavailable; no automatic retry'
    where organization_id=c.organization_id and status='pending' and phase='dispatching' and authorized_at<stamp-interval '60 seconds';
    update public.message_executions set status='missed',phase='complete',error='Dispatch window expired'
    where organization_id=c.organization_id and status='pending' and phase<>'dispatching'
      and coalesce(expires_at,scheduled_at+interval '5 seconds')<stamp;
    select coalesce(jsonb_agg(x),'[]') into result from (
      select * from public.message_executions where organization_id=c.organization_id and status='pending' and phase<>'dispatching'
      and scheduled_at<=stamp+interval '60 seconds' order by scheduled_at limit 100
    ) x; return result;
  elsif p_operation in ('prepare','authorize') then
    select * into e from public.message_executions where id=(p_data->>'id')::uuid and organization_id=c.organization_id for update;
    if e.id is null or e.status<>'pending' or e.phase='dispatching' then return null; end if;
    if not e.is_test then
      select * into s from public.message_schedules where id=e.schedule_id for update;
      if not s.enabled or s.deleted_at is not null or s.revision<>e.schedule_revision then
        update public.message_executions set status='cancelled',phase='complete',error='Schedule changed or automation disabled' where id=e.id; return null;
      end if;
      if not c.automatic_enabled then return null; end if;
    end if;
    if coalesce(e.expires_at,e.scheduled_at+interval '5 seconds')<stamp then
      update public.message_executions set status='missed',phase='complete',error='Dispatch window expired' where id=e.id; return null;
    end if;
    if not c.compatible or c.state<>'ready' or not exists(select 1 from public.message_destinations where organization_id=c.organization_id and group_id=e.group_id and available) then return null; end if;
    if p_operation='prepare' then
      update public.message_executions set phase='prepared',instance_id=p_instance_id,fence=c.fence where id=e.id;
      return to_jsonb(e);
    end if;
    if stamp<e.scheduled_at then return null; end if;
    if e.phase<>'prepared' or e.instance_id<>p_instance_id or e.fence<>c.fence then return null; end if;
    attempt:=gen_random_uuid();
    update public.message_executions set phase='dispatching',attempt_id=attempt,authorized_at=stamp where id=e.id returning * into e;
    return to_jsonb(e);
  elsif p_operation='result' then
    select * into e from public.message_executions where id=(p_data->>'id')::uuid and organization_id=c.organization_id for update;
    if e.id is null or e.attempt_id is distinct from (p_data->>'attempt_id')::uuid then raise exception 'Invalid dispatch attempt'; end if;
    if p_data->>'status' not in ('sent','unknown','failed','missed') then raise exception 'Invalid result'; end if;
    if e.status='sent' and p_data->>'status'<>'sent' then return '{}'; end if;
    update public.message_executions set status=p_data->>'status',phase='complete',dispatch_at=(p_data->>'dispatch_at')::timestamptz,
      acknowledgement_at=(p_data->>'acknowledgement_at')::timestamptz,provider_message_id=p_data->>'provider_message_id',
      latency_ms=extract(epoch from ((p_data->>'dispatch_at')::timestamptz-scheduled_at))*1000,error=left(p_data->>'error',500) where id=e.id;
  elsif p_operation='commands' then
    update public.message_worker_commands set status='expired' where organization_id=c.organization_id and status in ('pending','claimed') and expires_at<stamp;
    with claimed as(update public.message_worker_commands set status='claimed' where organization_id=c.organization_id and status='pending' returning *)
    select coalesce(jsonb_agg(claimed),'[]') into result from claimed; return result;
  elsif p_operation='command_complete' then
    update public.message_worker_commands set status='complete' where organization_id=c.organization_id and id=(p_data->>'id')::uuid;
  else raise exception 'Unknown worker operation'; end if;
  return '{}';
end $$;
revoke all on function public.message_worker(uuid,text,uuid,text,jsonb) from public;
grant execute on function public.message_worker(uuid,text,uuid,text,jsonb) to anon,authenticated;
