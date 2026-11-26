-- Match organization playgrounds without creating duplicates from WhatsApp address text.
create or replace function public.signup_import_existing_playground(p_organization_id uuid,p_location text,p_raw_text text default '')
returns uuid language plpgsql stable set search_path=public as $$
declare ids uuid[]; haystack text;
begin
  select array_agg(id) into ids from playgrounds where organization_id=p_organization_id
    and trim(regexp_replace(lower(name),'[^[:alnum:]]+',' ','g'))=trim(regexp_replace(lower(coalesce(p_location,'')),'[^[:alnum:]]+',' ','g'));
  if coalesce(cardinality(ids),0)>0 then return case when cardinality(ids)=1 then ids[1] end; end if;
  foreach haystack in array array[p_location,p_raw_text] loop
    haystack:=trim(regexp_replace(lower(coalesce(haystack,'')),'[^[:alnum:]]+',' ','g'));
    select array_agg(id) into ids from playgrounds where organization_id=p_organization_id and trim(name)<>''
      and haystack ~ ('\m'||replace(trim(regexp_replace(lower(name),'[^[:alnum:]]+',' ','g')),' ','\M.*\m')||'\M');
    if coalesce(cardinality(ids),0)>0 then return case when cardinality(ids)=1 then ids[1] end; end if;
  end loop;
  return null;
end $$;
revoke all on function public.signup_import_existing_playground(uuid,text,text) from public,anon,authenticated;
grant execute on function public.signup_import_existing_playground(uuid,text,text) to service_role;

create or replace function public.signup_import_save(p_run_id uuid,p_organization_id uuid,p_claim_token uuid,p_payload jsonb,p_finalize boolean default false,p_review boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r signup_import_runs%rowtype; sid uuid; ids uuid[]; item jsonb; season uuid; program uuid; creator uuid; session_data jsonb; ground uuid; ground_name text; date_name text;
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
  session_data:=p_payload->'parsed_json'->'session';
  date_name:=to_char(r.target_date,'FMMonth FMDDth');
  ground:=public.signup_import_existing_playground(p_organization_id,session_data->>'location',coalesce(p_payload->'source_message'->>'body',r.source_message->>'body',''));
  select name into ground_name from playgrounds where id=ground and organization_id=p_organization_id;
  if sid is null then
    insert into sessions(organization_id,program_id,season_id,session_date,name,playground_id,location,start_time,end_time,price_per_session,status,created_by,notes)
    values(p_organization_id,program,season,r.target_date,date_name,ground,coalesce(ground_name,session_data->>'location'),nullif(session_data->>'startTime','')::time,nullif(session_data->>'endTime','')::time,nullif(session_data->>'pricePerSession','')::numeric,'scheduled',creator,'Prepared by scheduled WhatsApp signup import') returning id into sid;
  end if;
  if exists(select 1 from sessions where id=sid and status<>'scheduled') then raise exception 'Target session is completed or cancelled'; end if;
  -- Repair generic import defaults and missing links when a prepared draft is revisited.
  -- Explicit session names and existing playground choices remain authoritative.
  update sessions set name=case when name is null or name in ('Weekly soccer',r.target_date::text) then date_name else name end,
    playground_id=coalesce(playground_id,ground),
    location=case when playground_id is null and ground is not null then ground_name else location end where id=sid;
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
