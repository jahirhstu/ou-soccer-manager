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
