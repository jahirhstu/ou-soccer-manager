-- Signup reading is independent of automatic outgoing messages. All writes go through
-- scoped server actions or worker-authenticated API requests, never browser table writes.
create table public.signup_import_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  program_id uuid not null references public.programs(id),
  season_id uuid not null references public.seasons(id),
  destination_id uuid not null,
  name text not null check(length(name) between 1 and 120),
  timezone text not null default 'America/Toronto',
  weekday integer not null check(weekday between 1 and 7), local_time time not null,
  session_weekday integer not null default 7 check(session_weekday between 1 and 7),
  opening_weekday integer not null default 1 check(opening_weekday between 1 and 7),
  opening_time time not null default '21:00:00', capacity integer not null default 21 check(capacity between 1 and 200),
  enabled boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(destination_id,organization_id) references public.message_destinations(id,organization_id)
);
create table public.signup_import_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  schedule_id uuid not null references public.signup_import_schedules(id),
  scheduled_at timestamptz not null, target_date date not null,
  window_from timestamptz not null, window_until timestamptz not null,
  configuration jsonb not null,
  manual boolean not null default false,
  status text not null default 'queued' check(status in ('queued','reading','needs_review','imported','failed','missed')),
  claim_token uuid, claimed_by uuid, claim_until timestamptz,
  incoming_messages jsonb, history_complete boolean not null default false,
  source_message jsonb, parsed_json jsonb, draft jsonb, selections jsonb not null default '{}',
  session_id uuid references public.sessions(id), error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(schedule_id,scheduled_at), check(window_from<=window_until)
);
create index signup_import_runs_pending on public.signup_import_runs(organization_id,status,scheduled_at);
-- Keep automation ownership separate from attendance's historical/exported record shape.
create table public.signup_import_attendance (
  session_id uuid not null, player_id uuid not null,
  run_id uuid not null references public.signup_import_runs(id),
  primary key(session_id,player_id),
  foreign key(session_id,player_id) references public.attendance(session_id,player_id) on delete cascade
);
alter table public.signup_import_attendance enable row level security;
revoke all on public.signup_import_attendance from public,anon,authenticated;
grant all on public.signup_import_attendance to service_role;

create function public.signup_import_schedule_scope() returns trigger language plpgsql set search_path=public as $$
begin
  if not exists(select 1 from seasons where id=new.season_id and organization_id=new.organization_id and program_id=new.program_id) then raise exception 'Season scope does not match'; end if;
  if not exists(select 1 from pg_timezone_names where name=new.timezone) then raise exception 'Invalid timezone'; end if;
  new.updated_at:=clock_timestamp(); return new;
end $$;
create trigger signup_import_schedule_scope before insert or update on public.signup_import_schedules for each row execute function public.signup_import_schedule_scope();

-- Manual attendance edits relinquish ownership, so later reruns cannot overwrite them.
create function public.signup_import_attendance_ownership() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if current_setting('signup_import.applying',true) is distinct from 'true' then delete from signup_import_attendance where session_id=new.session_id and player_id=new.player_id; end if;
  return new;
end $$;
create trigger signup_import_attendance_ownership before insert or update on public.attendance for each row execute function public.signup_import_attendance_ownership();

alter table public.signup_import_schedules enable row level security;
alter table public.signup_import_runs enable row level security;
create policy admin_read on public.signup_import_schedules for select to authenticated using(public.organization_role(organization_id)='admin');
create policy admin_read on public.signup_import_runs for select to authenticated using(public.organization_role(organization_id)='admin');
revoke all on public.signup_import_schedules,public.signup_import_runs from anon,authenticated;
grant select on public.signup_import_schedules,public.signup_import_runs to authenticated;
grant all on public.signup_import_schedules,public.signup_import_runs to service_role;

-- Only the server holds service credentials; worker credentials remain organization scoped.
create function public.signup_import_worker_context(p_worker_id uuid,p_token text,p_instance_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare c message_worker_connections%rowtype;
begin
  select * into c from message_worker_connections where id=p_worker_id;
  if c.id is null or c.token_hash is distinct from encode(extensions.digest(p_token,'sha256'),'hex') then raise exception 'Invalid worker credential'; end if;
  if p_instance_id is null or c.instance_id is distinct from p_instance_id or c.lease_until is null or c.lease_until<=clock_timestamp() then raise exception 'Worker lease lost'; end if;
  return c.organization_id;
end $$;
revoke all on function public.signup_import_worker_context(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.signup_import_worker_context(uuid,text,uuid) to service_role;

-- Server calculates valid timezone occurrences; row lock + unique occurrence prevents duplicates.
create function public.signup_import_claim(p_organization_id uuid,p_schedule_id uuid,p_instance_id uuid,p_scheduled_at timestamptz,p_window jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s signup_import_schedules%rowtype; r signup_import_runs%rowtype;
begin
  select * into s from signup_import_schedules where id=p_schedule_id and organization_id=p_organization_id and enabled for update;
  if s.id is null then return null; end if;
  if p_scheduled_at<s.created_at or p_scheduled_at>clock_timestamp() then return null; end if;
  insert into signup_import_runs(organization_id,schedule_id,scheduled_at,target_date,window_from,window_until,configuration,status,error)
  values(s.organization_id,s.id,p_scheduled_at,(p_window->>'target_date')::date,(p_window->>'from')::timestamptz,(p_window->>'until')::timestamptz,to_jsonb(s),
    case when p_scheduled_at<clock_timestamp()-interval '60 minutes' then 'missed' else 'queued' end,
    case when p_scheduled_at<clock_timestamp()-interval '60 minutes' then 'Execution recovery window expired' end)
  on conflict(schedule_id,scheduled_at) do nothing;
  select * into r from signup_import_runs where schedule_id=s.id and scheduled_at=p_scheduled_at for update;
  if r.status not in ('queued','reading') or (r.claim_until is not null and r.claim_until>clock_timestamp()) then return null; end if;
  if not r.manual and r.scheduled_at<clock_timestamp()-interval '60 minutes' then
    update signup_import_runs set status='missed',error='Execution recovery window expired',updated_at=clock_timestamp() where id=r.id;return null;
  end if;
  update signup_import_runs set status='reading',claim_token=gen_random_uuid(),claimed_by=p_instance_id,claim_until=clock_timestamp()+interval '10 minutes',updated_at=clock_timestamp() where id=r.id returning * into r;
  return to_jsonb(r);
end $$;
revoke all on function public.signup_import_claim(uuid,uuid,uuid,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.signup_import_claim(uuid,uuid,uuid,timestamptz,jsonb) to service_role;

-- Session preparation and roster application are atomic; drafts never write attendance.
create function public.signup_import_save(p_run_id uuid,p_organization_id uuid,p_claim_token uuid,p_payload jsonb,p_finalize boolean default false,p_review boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r signup_import_runs%rowtype; sid uuid; ids uuid[]; item jsonb; season uuid; program uuid; creator uuid; session_data jsonb;
begin
  select * into r from signup_import_runs where id=p_run_id and organization_id=p_organization_id for update;
  if r.id is null then raise exception 'Run unavailable'; end if;
  if r.status='imported' then return to_jsonb(r); end if;
  if p_review then
    if r.status<>'needs_review' then raise exception 'Run is not awaiting review'; end if;
  elsif r.status<>'reading' or r.claim_token is distinct from p_claim_token or r.claim_until<=clock_timestamp() then raise exception 'Import claim expired'; end if;
  if not p_review and not exists(select 1 from message_worker_connections where organization_id=p_organization_id and instance_id=r.claimed_by and lease_until>clock_timestamp()) then raise exception 'Worker lease lost'; end if;
  if not p_review and not exists(select 1 from signup_import_schedules where id=r.schedule_id and enabled and updated_at=(r.configuration->>'updated_at')::timestamptz) then raise exception 'Import schedule changed or was disabled; review this run'; end if;
  season:=(r.configuration->>'season_id')::uuid;program:=(r.configuration->>'program_id')::uuid;creator:=(r.configuration->>'created_by')::uuid;
  if not exists(select 1 from seasons where id=season and organization_id=p_organization_id and program_id=program) then raise exception 'Season unavailable'; end if;
  if not exists(select 1 from programs where id=program and status='active') or exists(select 1 from program_modules where program_id=program and module_key='whatsapp_import' and not enabled) then raise exception 'WhatsApp import is disabled'; end if;
  -- Serialize creation/allocation for the same season/date across schedules and runs.
  perform pg_advisory_xact_lock(hashtextextended(season::text||':'||r.target_date::text,0));
  select array_agg(id) into ids from sessions where season_id=season and session_date=r.target_date and organization_id=p_organization_id;
  if coalesce(cardinality(ids),0)>1 then raise exception 'Multiple sessions match the target date; resolve before retrying'; end if;
  sid:=ids[1];
  if sid is null then
    session_data:=p_payload->'parsed_json'->'session';
    insert into sessions(organization_id,program_id,season_id,session_date,name,location,start_time,end_time,price_per_session,status,created_by,notes)
    values(p_organization_id,program,season,r.target_date,coalesce(nullif(session_data->>'name',''),'Weekly soccer'),session_data->>'location',nullif(session_data->>'startTime','')::time,nullif(session_data->>'endTime','')::time,nullif(session_data->>'pricePerSession','')::numeric,'scheduled',creator,'Prepared by scheduled WhatsApp signup import') returning id into sid;
  end if;
  if exists(select 1 from sessions where id=sid and status<>'scheduled') then raise exception 'Target session is completed or cancelled'; end if;
  if p_finalize then
    if coalesce((p_payload->'draft'->>'needs_review')::boolean,true) then raise exception 'Resolve the draft before finalizing'; end if;
    if not exists(select 1 from jsonb_array_elements(p_payload->'draft'->'rows') entry where entry->>'status'='confirmed') then raise exception 'Roster has no confirmed players'; end if;
    if (select count(*) from jsonb_array_elements(p_payload->'draft'->'rows') entry where entry->>'status'='confirmed')>(r.configuration->>'capacity')::integer then raise exception 'Roster exceeds capacity'; end if;
    -- Manual records and automation belonging to a different schedule are never replaced.
    if exists(select 1 from attendance a left join signup_import_attendance ownership on ownership.session_id=a.session_id and ownership.player_id=a.player_id left join signup_import_runs previous on previous.id=ownership.run_id where a.session_id=sid and (previous.id is null or previous.schedule_id<>r.schedule_id)) then raise exception 'Session contains manual attendance or another schedule roster; review it before importing'; end if;
    perform set_config('signup_import.applying','true',true);
    delete from attendance a using signup_import_attendance ownership, signup_import_runs previous where a.session_id=sid and ownership.session_id=a.session_id and ownership.player_id=a.player_id and previous.id=ownership.run_id and previous.schedule_id=r.schedule_id;
    for item in select * from jsonb_array_elements(p_payload->'draft'->'rows') loop
      if item->>'status'='ignored' then continue; end if;
      if item->>'status' not in ('confirmed','waitlisted') or nullif(item->>'player_id','') is null then raise exception 'Unresolved player'; end if;
      if not exists(select 1 from players where id=(item->>'player_id')::uuid and organization_id=p_organization_id) then raise exception 'Player outside organization'; end if;
      insert into attendance(session_id,player_id,status,created_by,notes)
      values(sid,(item->>'player_id')::uuid,item->>'status',creator,'Signup order: '|| (item->>'order'));
      insert into signup_import_attendance(session_id,player_id,run_id) values(sid,(item->>'player_id')::uuid,r.id);
    end loop;
    perform set_config('signup_import.applying','false',true);
  end if;
  update signup_import_runs set session_id=sid,source_message=coalesce(p_payload->'source_message',source_message),parsed_json=coalesce(p_payload->'parsed_json',parsed_json),draft=p_payload->'draft',selections=coalesce(p_payload->'selections',selections),status=case when p_finalize then 'imported' else 'needs_review' end,error=p_payload->>'error',claim_until=null,updated_at=clock_timestamp() where id=r.id returning * into r;
  return to_jsonb(r);
end $$;
revoke all on function public.signup_import_save(uuid,uuid,uuid,jsonb,boolean,boolean) from public,anon,authenticated;
grant execute on function public.signup_import_save(uuid,uuid,uuid,jsonb,boolean,boolean) to service_role;
