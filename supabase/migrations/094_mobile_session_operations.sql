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
