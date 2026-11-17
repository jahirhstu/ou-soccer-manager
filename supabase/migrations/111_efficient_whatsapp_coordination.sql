-- Additive protocol: legacy workers retain their existing API and 10-second heartbeat.
-- Sequence-backed row versions avoid cross-table lock cycles and append-only change logs.
create sequence public.message_coordination_version_seq;
revoke all on sequence public.message_coordination_version_seq from public,anon,authenticated;
alter table public.message_worker_connections
  add column heartbeat_interval_seconds integer not null default 10 check(heartbeat_interval_seconds in (10,30)),
  add column configuration_revision bigint not null default nextval('public.message_coordination_version_seq'),
  add column last_sync_at timestamptz;

create function public.message_row_version() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if (to_jsonb(old)-'coordination_revision') is distinct from (to_jsonb(new)-'coordination_revision') then
    new.coordination_revision:=nextval('public.message_coordination_version_seq');
  else new.coordination_revision:=old.coordination_revision; end if;
  return new;
end $$;
-- Security-definer triggers assign defaults so normal administrator inserts need no sequence privilege.
create function public.message_row_insert_version() returns trigger
language plpgsql security definer set search_path=public as $$
begin new.coordination_revision:=nextval('public.message_coordination_version_seq'); return new; end $$;
do $$ declare t text; begin
  foreach t in array array['message_schedules','message_templates','message_destinations','message_executions'] loop
    execute format('alter table public.%I add column coordination_revision bigint not null default 0',t);
    execute format('create trigger message_insert_version before insert on public.%I for each row execute function public.message_row_insert_version()',t);
    execute format('create trigger message_update_version before update on public.%I for each row execute function public.message_row_version()',t);
    execute format('create index on public.%I(organization_id,coordination_revision desc)',t);
  end loop;
end $$;
create function public.message_automation_version() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.automatic_enabled is distinct from old.automatic_enabled then
    new.configuration_revision:=nextval('public.message_coordination_version_seq');
  end if;
  return new;
end $$;
create trigger message_automation_version before update of automatic_enabled on public.message_worker_connections
for each row execute function public.message_automation_version();
create function public.message_configuration_version(p_organization_id uuid) returns text
language sql stable set search_path=public as $$
  select greatest(
    coalesce((select max(configuration_revision) from public.message_worker_connections where organization_id=p_organization_id),0),
    coalesce((select max(coordination_revision) from public.message_schedules where organization_id=p_organization_id),0),
    coalesce((select max(coordination_revision) from public.message_templates where organization_id=p_organization_id),0),
    coalesce((select max(coordination_revision) from public.message_destinations where organization_id=p_organization_id),0))::text;
$$;
create function public.message_work_version(p_organization_id uuid) returns text
language sql stable set search_path=public as $$
  select coalesce(max(coordination_revision),0)::text from public.message_executions where organization_id=p_organization_id;
$$;
revoke all on function public.message_configuration_version(uuid),public.message_work_version(uuid) from public,anon,authenticated;

alter table public.message_worker_commands drop constraint message_worker_commands_command_check;
alter table public.message_worker_commands add constraint message_worker_commands_command_check
  check(command in ('reconnect','disconnect','refresh_groups'));
create function public.message_request_group_refresh(p_organization_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or public.organization_role(p_organization_id) is distinct from 'admin' then raise exception 'Organization administrator required'; end if;
  if not exists(select 1 from public.message_worker_connections where organization_id=p_organization_id) then raise exception 'Provision a worker first'; end if;
  insert into public.message_worker_commands(organization_id,command) values(p_organization_id,'refresh_groups');
end $$;
revoke all on function public.message_request_group_refresh(uuid) from public,anon;
grant execute on function public.message_request_group_refresh(uuid) to authenticated;

-- Apply negotiated liveness thresholds to administrator actions and legacy rollback.
create or replace function public.message_admin(p_organization_id uuid, p_operation text, p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.message_worker_connections%rowtype; token text; result jsonb; destination public.message_destinations%rowtype;
begin
  if auth.uid() is null or public.organization_role(p_organization_id) is distinct from 'admin' then raise exception 'Organization administrator required'; end if;
  select * into c from public.message_worker_connections where organization_id=p_organization_id for update;
  if p_operation='status' then
    return case when c.id is null then null else (to_jsonb(c)-'token_hash'-'instance_id') || jsonb_build_object('configuration_revision',public.message_configuration_version(p_organization_id),'work_revision',public.message_work_version(p_organization_id)) end;
  elsif p_operation='provision' then
    token:=encode(extensions.gen_random_bytes(32),'hex');
    insert into public.message_worker_connections(organization_id,token_hash) values(p_organization_id,encode(extensions.digest(token,'sha256'),'hex'))
    on conflict(organization_id) do update set token_hash=excluded.token_hash,automatic_enabled=false,compatible=false,lease_until=null,instance_id=null,fence=message_worker_connections.fence+1
    returning * into c;
    return jsonb_build_object('worker_id',c.id,'token',token);
  elsif p_operation='automation' then
    if c.id is null then raise exception 'Provision a worker first'; end if;
    if (p_data->>'enabled')::boolean and (not c.compatible or c.state<>'ready' or c.heartbeat_at is null or c.heartbeat_at<now()-make_interval(secs=>3*c.heartbeat_interval_seconds)) then
      raise exception 'A compatible connected worker is required';
    end if;
    update public.message_worker_connections set automatic_enabled=(p_data->>'enabled')::boolean where id=c.id;
  elsif p_operation in ('reconnect','disconnect') then
    if c.id is null then raise exception 'Provision a worker first'; end if;
    if p_operation='disconnect' then update public.message_worker_connections set automatic_enabled=false where id=c.id; end if;
    insert into public.message_worker_commands(organization_id,command) values(p_organization_id,p_operation);
  elsif p_operation='test' then
    select * into destination from public.message_destinations where id=(p_data->>'destination_id')::uuid and organization_id=p_organization_id and available;
    if destination.id is null or c.id is null or c.state is distinct from 'ready' or not c.compatible or c.heartbeat_at is null or c.heartbeat_at<now()-make_interval(secs=>3*c.heartbeat_interval_seconds) then raise exception 'Connected worker and available group required'; end if;
    if length(p_data->>'body') not between 1 and 10000 then raise exception 'Invalid message'; end if;
    insert into public.message_executions(organization_id,body,group_id,scheduled_at,is_test,expires_at)
    values(p_organization_id,p_data->>'body',destination.group_id,clock_timestamp(),true,clock_timestamp()+interval '60 seconds');
  else raise exception 'Unknown operation'; end if;
  return '{}'::jsonb;
end $$;
revoke all on function public.message_admin(uuid,text,jsonb) from public,anon;
grant execute on function public.message_admin(uuid,text,jsonb) to authenticated;


create or replace function public.message_worker(p_worker_id uuid,p_token text,p_instance_id uuid,p_operation text,p_data jsonb default '{}')
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
      heartbeat_interval_seconds=10,heartbeat_at=stamp,state=p_data->>'state',compatible=coalesce((p_data->>'compatible')::boolean,false) where id=c.id;
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

-- Called once per 30-second interval. No browser work occurs inside this transaction.
create function public.message_worker_coordinate(p_worker_id uuid,p_token text,p_instance_id uuid,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.message_worker_connections%rowtype; commands jsonb; configuration jsonb; executions jsonb; config_version text; work_version text;
begin
  if coalesce((p_data->>'release')::boolean,false) then
    select * into c from public.message_worker_connections where id=p_worker_id for update;
    if c.id is null or c.token_hash is distinct from encode(extensions.digest(p_token,'sha256'),'hex') then raise exception 'Invalid worker credential'; end if;
    if p_instance_id is null or c.instance_id is distinct from p_instance_id then raise exception 'Worker lease lost'; end if;
    update public.message_worker_connections set lease_until=clock_timestamp(),state='offline',heartbeat_interval_seconds=10 where id=c.id;
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
  update public.message_worker_connections set instance_id=p_instance_id,fence=c.fence,heartbeat_interval_seconds=30,
    lease_until=clock_timestamp()+interval '90 seconds',heartbeat_at=clock_timestamp(),last_sync_at=clock_timestamp(),
    state=p_data->>'state',compatible=coalesce((p_data->>'compatible')::boolean,false)
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
  return jsonb_build_object('configuration_revision',config_version,'work_revision',work_version,
    'configuration',configuration,'executions',executions,'commands',commands,'automatic_enabled',c.automatic_enabled,
    'last_scan_at',coalesce(c.last_scan_at,c.created_at),'fence',c.fence);
end $$;
revoke all on function public.message_worker_coordinate(uuid,text,uuid,jsonb) from public;
grant execute on function public.message_worker_coordinate(uuid,text,uuid,jsonb) to anon,authenticated;

create function public.message_worker_materialize_batch(p_worker_id uuid,p_token text,p_instance_id uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.message_worker_connections%rowtype; item jsonb; executions jsonb;
begin
  select * into c from public.message_worker_connections where id=p_worker_id for update;
  if c.id is null or c.token_hash is distinct from encode(extensions.digest(p_token,'sha256'),'hex') then raise exception 'Invalid worker credential'; end if;
  if p_instance_id is null or c.instance_id is distinct from p_instance_id or c.lease_until is null or c.lease_until<=clock_timestamp() then raise exception 'Worker lease lost'; end if;
  if p_data->>'configuration_revision' is distinct from public.message_configuration_version(c.organization_id) then raise exception 'Configuration changed; synchronize again'; end if;
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
  return jsonb_build_object('executions',executions,'work_revision',public.message_work_version(c.organization_id));
end $$;
revoke all on function public.message_worker_materialize_batch(uuid,text,uuid,jsonb) from public;
grant execute on function public.message_worker_materialize_batch(uuid,text,uuid,jsonb) to anon,authenticated;
