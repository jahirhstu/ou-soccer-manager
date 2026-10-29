-- Authenticated mobile reads deliberately do not depend on public-report visibility.
alter table public.profiles add column if not exists photo_path text;

create or replace function public.mobile_program_access(p_program_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(exists (
    select 1 from public.programs p
    join public.organizations o on o.id = p.organization_id and o.onboarding_status = 'active'
    join public.organization_members om on om.organization_id = o.id
      and om.profile_id = auth.uid() and om.status = 'active'
    where p.id = p_program_id and p.status = 'active'
      and (om.role in ('owner','admin') or exists (
        select 1 from public.program_members pm where pm.program_id = p.id
          and pm.profile_id = auth.uid() and pm.status = 'active'
      ))
  ), false);
$$;

create or replace function public.mobile_context()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_profile jsonb; v_workspaces jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select jsonb_build_object('id',id,'displayName',display_name,'email',email,'photoPath',photo_path)
    into v_profile from public.profiles where id = auth.uid();
  select coalesce(jsonb_agg(jsonb_build_object(
    'organizationId',o.id,'organizationName',o.name,'programId',p.id,'programName',p.name,
    'activityType',p.activity_type,'role',public.program_role(p.id),'organizationRole',om.role,
    'playerId',coalesce(pm.player_id,om.player_id),
    'currency',coalesce(os.currency_code,'CAD'),
    'modules',coalesce((select jsonb_object_agg(module_key,enabled) from public.program_modules where program_id=p.id),'{}'::jsonb)
  ) order by o.name,p.name),'[]'::jsonb) into v_workspaces
  from public.programs p join public.organizations o on o.id=p.organization_id
  join public.organization_members om on om.organization_id=o.id and om.profile_id=auth.uid() and om.status='active'
  left join public.program_members pm on pm.program_id=p.id and pm.profile_id=auth.uid() and pm.status='active'
  left join public.organization_settings os on os.organization_id=o.id
  where public.mobile_program_access(p.id);
  return jsonb_build_object('profile',v_profile,'workspaces',v_workspaces,'requests',coalesce((
    select jsonb_agg(jsonb_build_object('name',o.name,'status',m.status))
    from public.organization_members m join public.organizations o on o.id=m.organization_id
    where m.profile_id=auth.uid() and m.status<>'active'
  ),'[]'::jsonb));
end;
$$;

create or replace function public.mobile_list(p_program_id uuid, p_resource text, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_player uuid; v_manager boolean; v_module text; v_rows jsonb; v_currency text;
begin
  if not public.mobile_program_access(p_program_id) then raise exception 'Program access required'; end if;
  if p_offset is null or p_offset < 0 then raise exception 'Invalid page'; end if;
  v_manager := public.program_role(p_program_id)='manager';
  select coalesce(pm.player_id,om.player_id),coalesce(os.currency_code,'CAD') into v_player,v_currency
    from public.programs p
    join public.organization_members om on om.organization_id=p.organization_id and om.profile_id=auth.uid() and om.status='active'
    left join public.program_members pm on pm.program_id=p.id and pm.profile_id=auth.uid() and pm.status='active'
    left join public.organization_settings os on os.organization_id=p.organization_id where p.id=p_program_id;
  v_module := case when p_resource in ('balances','payments','myBalances','myPayments') then 'payments'
    when p_resource='expenses' then 'expenses'
    when p_resource in ('statistics','myStatistics') then 'scores'
    when p_resource in ('sessions','upcomingSessions','mySessions','seasons') then 'activities'
    when p_resource in ('members','players') then 'members' else p_resource end;
  if not public.is_program_module_enabled(p_program_id,v_module) then raise exception 'Module is disabled'; end if;
  if p_resource in ('players','expenses','members') and not v_manager then raise exception 'Manager access required'; end if;
  -- One ordered, bounded page. Financial views are only evaluated for this season scope.
  if p_resource in ('sessions','upcomingSessions','mySessions') then
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_rows from (
      select s.id,coalesce(s.name,s.session_date::text) title,
        s.session_date::text || ' / ' || s.status subtitle,coalesce(pg.name,s.location,'') detail
      from public.sessions s left join public.playgrounds pg on pg.id=s.playground_id
      where s.program_id=p_program_id
        and (p_resource<>'upcomingSessions' or (s.session_date>=current_date and s.status='scheduled'))
        and (p_resource<>'mySessions' or exists (
          select 1 from public.attendance a where a.session_id=s.id and a.player_id=v_player and a.status in ('played','replacement')
        )) order by case when p_resource='upcomingSessions' then s.session_date end asc,s.session_date desc,s.id limit 26 offset p_offset
    ) r;
  elsif p_resource='seasons' then
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_rows from (
      select id,name title,status subtitle,coalesce(start_date::text,'') || ' - ' || coalesce(end_date::text,'') detail
      from public.seasons where program_id=p_program_id order by start_date desc nulls last,id limit 26 offset p_offset
    ) r;
  elsif p_resource in ('balances','myBalances') then
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_rows from (
      select summary.player_id::text || ':' || s.id::text id,summary.player_name title,
        s.name subtitle,v_currency || ' ' || (coalesce(summary.credit_amount,0)-coalesce(summary.owes_money,0))::numeric(12,2)::text detail
      from public.seasons s join public.player_season_payment_summary summary on summary.season_id=s.id
      join public.players player on player.id=summary.player_id and player.organization_id=s.organization_id
      where s.program_id=p_program_id and ((v_manager and p_resource='balances') or summary.player_id=v_player)
      order by s.start_date desc nulls last,summary.player_name,summary.player_id,s.id limit 26 offset p_offset
    ) r;
  elsif p_resource in ('payments','myPayments') then
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_rows from (
      select l.id,p.display_name title,replace(l.type,'_',' ') || ' / ' || coalesce(l.refund_date::text,l.created_at::date::text) subtitle,
        v_currency || ' ' || coalesce(l.amount,0)::numeric(12,2)::text || ' / ' || s.name detail
      from public.ledger_entries l join public.seasons s on s.id=l.season_id join public.players p on p.id=l.player_id
      where s.program_id=p_program_id and ((v_manager and p_resource='payments') or l.player_id=v_player)
      order by l.created_at desc,l.id limit 26 offset p_offset
    ) r;
  elsif p_resource in ('statistics','myStatistics') then
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_rows from (
      select st.player_id::text || ':' || s.id::text id,p.display_name title,s.name subtitle,
        coalesce(st.goals,0)::text || ' goals / ' || coalesce(st.assists,0)::text || ' assists / ' || coalesce(st.appearances,0)::text || ' appearances' detail
      from public.player_season_stats_summary st join public.seasons s on s.id=st.season_id
      join public.players p on p.id=st.player_id and p.organization_id=s.organization_id
      where s.program_id=p_program_id and (p_resource='statistics' or p.id=v_player)
        and (st.appearances>0 or st.goals>0 or st.assists>0 or exists(
          select 1 from public.program_members pm where pm.program_id=p_program_id and pm.player_id=p.id
        ))
      order by st.goals desc,st.assists desc,st.player_id,s.id limit 26 offset p_offset
    ) r;
  elsif p_resource='players' then
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_rows from (
      select p.id,p.display_name title,p.status subtitle,coalesce(p.email,p.phone,'') detail
      from public.players p where exists(select 1 from public.program_members pm where pm.program_id=p_program_id and pm.player_id=p.id)
      order by p.display_name,p.id limit 26 offset p_offset
    ) r;
  elsif p_resource='expenses' then
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_rows from (
      select e.id,e.category title,e.expense_date::text subtitle,v_currency || ' ' || e.amount::numeric(12,2)::text detail
      from public.club_expenses e where e.program_id=p_program_id order by e.expense_date desc,e.id limit 26 offset p_offset
    ) r;
  elsif p_resource='members' then
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_rows from (
      select m.id,coalesce(p.display_name,player.display_name,'Unlinked member') title,m.role || ' / ' || m.status subtitle,
        coalesce(p.email,'') detail
      from public.program_members m left join public.profiles p on p.id=m.profile_id
      left join public.players player on player.id=m.player_id where m.program_id=p_program_id
      order by m.created_at desc,m.id limit 26 offset p_offset
    ) r;
  else raise exception 'Unknown resource';
  end if;
  return jsonb_build_object('rows',case when jsonb_array_length(v_rows)>25 then v_rows-25 else v_rows end,'hasMore',jsonb_array_length(v_rows)>25);
end;
$$;

create or replace function public.mobile_session(p_program_id uuid, p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if not public.mobile_program_access(p_program_id)
    or not public.is_program_module_enabled(p_program_id,'activities')
    or not exists(select 1 from public.sessions where id=p_session_id and program_id=p_program_id)
    then raise exception 'Session access required'; end if;
  if not public.is_program_module_enabled(p_program_id,'scores')
    or not public.is_program_module_enabled(p_program_id,'teams') then raise exception 'Match day is disabled'; end if;
  return public.public_game_score_editor(p_session_id);
end;
$$;

revoke all on function public.mobile_program_access(uuid),public.mobile_context(),public.mobile_list(uuid,text,integer),public.mobile_session(uuid,uuid) from public,anon;
grant execute on function public.mobile_program_access(uuid),public.mobile_context(),public.mobile_list(uuid,text,integer),public.mobile_session(uuid,uuid) to authenticated;

-- Private account photos. No organization identity is inferred from names or email.
-- Conditional installation permits local schema tests without Supabase Storage.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
      values('profile-photos','profile-photos',false,2097152,array['image/jpeg','image/png','image/webp'])
      on conflict(id) do update set public=false,file_size_limit=2097152,allowed_mime_types=excluded.allowed_mime_types;
    execute 'create policy profile_photos_owner_read on storage.objects for select to authenticated using
      (bucket_id = ''profile-photos'' and (storage.foldername(name))[1] = auth.uid()::text)';
    execute 'create policy profile_photos_owner_insert on storage.objects for insert to authenticated with check
      (bucket_id = ''profile-photos'' and (storage.foldername(name))[1] = auth.uid()::text)';
    execute 'create policy profile_photos_owner_delete on storage.objects for delete to authenticated using
      (bucket_id = ''profile-photos'' and (storage.foldername(name))[1] = auth.uid()::text)';
  end if;
end;
$$;

create or replace function public.set_my_photo(p_path text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or p_path not like auth.uid()::text || '/%' or length(p_path)>200
    then raise exception 'Invalid photo path'; end if;
  if not exists(select 1 from storage.objects where bucket_id='profile-photos' and name=p_path)
    then raise exception 'Upload the photo first'; end if;
  update public.profiles set photo_path=p_path where id=auth.uid();
end;
$$;
revoke all on function public.set_my_photo(text) from public,anon;
grant execute on function public.set_my_photo(text) to authenticated;

create or replace function public.mobile_save_scores(p_program_id uuid,p_session_id uuid,p_games jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;
begin
  if not public.mobile_program_access(p_program_id)
    or public.program_role(p_program_id) not in ('manager','captain')
    or not exists(select 1 from public.sessions where id=p_session_id and program_id=p_program_id and status='scheduled')
    then raise exception 'This session cannot be scored by this account'; end if;
  v_result := public.save_program_game_scores(p_session_id,p_games);
  if v_result ? 'error' then raise exception '%',v_result->>'error'; end if;
  return v_result;
end;
$$;
revoke all on function public.mobile_save_scores(uuid,uuid,jsonb) from public,anon;
grant execute on function public.mobile_save_scores(uuid,uuid,jsonb) to authenticated;

create or replace function public.mobile_record_finance(p_program_id uuid,p_kind text,p_submission_id uuid,p_data jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_org uuid; v_season public.seasons%rowtype; v_player uuid;
  v_amount numeric; v_date date; v_method text; v_note text; v_id uuid;
  v_existing public.audit_logs%rowtype;
begin
  if not public.mobile_program_access(p_program_id) or public.program_role(p_program_id)<>'manager'
    or not public.can_manage_program_finance(p_program_id,case when p_kind='expense' then 'expenses' else 'payments' end)
    then raise exception 'Manager finance access required'; end if;
  if p_submission_id is null or p_kind not in ('payment','refund','transfer','carry','expense') then raise exception 'Invalid transaction'; end if;
  select organization_id into v_org from public.programs where id=p_program_id;
  perform pg_advisory_xact_lock(hashtextextended(p_submission_id::text,0));
  select * into v_existing from public.audit_logs where id=p_submission_id;
  if found then
    if v_existing.organization_id=v_org and v_existing.actor_id=auth.uid()
      and v_existing.action='mobile_' || p_kind || '_recorded'
      and v_existing.new_data->>'program_id'=p_program_id::text and v_existing.new_data->'payload'=p_data
      then return (v_existing.new_data->>'result_id')::uuid; end if;
    raise exception 'Submission ID already used for a different transaction';
  end if;
  select * into v_season from public.seasons where id=(p_data->>'seasonId')::uuid and program_id=p_program_id;
  if not found then raise exception 'Choose a season in this program'; end if;
  if coalesce(p_data->>'amount','') !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'Enter a decimal amount'; end if;
  v_amount := (p_data->>'amount')::numeric;
  v_date := (p_data->>'date')::date;
  v_method := p_data->>'method'; v_note := nullif(btrim(p_data->>'note'),'');
  if v_amount<=0 or v_amount>99999999.99 or v_date is null or v_date>current_date
    or length(coalesce(v_note,''))>300 then raise exception 'Invalid amount, date or reference'; end if;
  if p_kind<>'expense' then
    v_player := (p_data->>'playerId')::uuid;
    perform 1 from public.players where id=v_player and organization_id=v_org for update;
    if not found then raise exception 'Player does not belong to this organization'; end if;
  end if;
  if p_kind in ('payment','refund') and (v_method is null or v_method not in ('cash','e-transfer','other')) then raise exception 'Invalid payment method'; end if;
  if p_kind='refund' then
    v_id := public.record_player_refund(v_player,v_season.id,v_amount,v_date,v_method,v_note,p_submission_id);
  elsif p_kind='transfer' then
    v_id := public.transfer_player_credit(v_player,(p_data->>'recipientId')::uuid,v_season.id,v_amount,v_date,null,v_note,p_submission_id);
  elsif p_kind='carry' then
    v_id := public.carry_forward_player_balance(v_player,v_season.id,(p_data->>'destinationSeasonId')::uuid,v_amount,v_date,v_note,p_submission_id,'credit');
  elsif p_kind='payment' then
    insert into public.payments(organization_id,program_id,season_id,player_id,payment_date,amount,sessions_covered,payment_method,reference_note,created_by)
      values(v_org,p_program_id,v_season.id,v_player,v_date,v_amount,
        case when v_season.price_per_session>0 then round(v_amount/v_season.price_per_session,2) else 0 end,
        v_method,v_note,auth.uid()) returning id into v_id;
    insert into public.ledger_entries(organization_id,program_id,season_id,player_id,type,amount,sessions_count,description,created_by)
      values(v_org,p_program_id,v_season.id,v_player,'payment_received',v_amount,
        case when v_season.price_per_session>0 then round(v_amount/v_season.price_per_session,2) else 0 end,
        coalesce(v_note,'Mobile payment ' || v_id::text),auth.uid());
  else
    insert into public.club_expenses(organization_id,program_id,season_id,expense_date,category,amount,notes,created_by)
      values(v_org,p_program_id,v_season.id,v_date,p_data->>'category',v_amount,v_note,auth.uid()) returning id into v_id;
  end if;
  insert into public.audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,new_data)
    values(p_submission_id,v_org,auth.uid(),'mobile_' || p_kind || '_recorded','mobile_transaction',v_id,
      jsonb_build_object('result_id',v_id,'program_id',p_program_id,'season_id',v_season.id,'amount',v_amount,'payload',p_data));
  return v_id;
end;
$$;
revoke all on function public.mobile_record_finance(uuid,text,uuid,jsonb) from public,anon;
grant execute on function public.mobile_record_finance(uuid,text,uuid,jsonb) to authenticated;

create or replace function public.mobile_create_record(p_program_id uuid,p_kind text,p_id uuid,p_data jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_module text; v_existing public.audit_logs%rowtype;
begin
  v_module := case when p_kind='player' then 'members' else 'activities' end;
  if not public.mobile_program_access(p_program_id) or public.program_role(p_program_id)<>'manager'
    or not public.is_program_module_enabled(p_program_id,v_module) then raise exception 'Manager access required'; end if;
  select organization_id into v_org from public.programs where id=p_program_id;
  if p_id is null or p_kind not in ('season','session','player') then raise exception 'Invalid record'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  select * into v_existing from public.audit_logs where id=p_id;
  if found then
    if v_existing.organization_id=v_org and v_existing.actor_id=auth.uid()
      and v_existing.action='mobile_create_' || p_kind and v_existing.new_data->>'program_id'=p_program_id::text
      and v_existing.new_data->'payload'=p_data then return p_id; end if;
    raise exception 'Submission ID already used';
  end if;
  if length(btrim(coalesce(p_data->>'name','')))<1 or length(p_data->>'name')>150 then raise exception 'Enter a name (maximum 150 characters)'; end if;
  if p_kind in ('season','session') and (coalesce(p_data->>'price','') !~ '^[0-9]+(\.[0-9]{1,2})?$'
    or (p_data->>'price')::numeric>99999999.99) then raise exception 'Enter a nonnegative price'; end if;
  if p_kind='season' then
    if (p_data->>'endDate')::date<(p_data->>'startDate')::date then raise exception 'End date is before start date'; end if;
    insert into public.seasons(id,organization_id,program_id,name,start_date,end_date,price_per_session,total_planned_sessions,status,created_by)
      values(p_id,v_org,p_program_id,btrim(p_data->>'name'),(p_data->>'startDate')::date,(p_data->>'endDate')::date,
        (p_data->>'price')::numeric,(p_data->>'sessions')::integer,'draft',auth.uid());
  elsif p_kind='session' then
    if not exists(select 1 from public.seasons where id=(p_data->>'seasonId')::uuid and program_id=p_program_id) then raise exception 'Season must belong to this program'; end if;
    insert into public.sessions(id,organization_id,program_id,season_id,name,session_date,start_time,end_time,price_per_session,location,created_by)
      values(p_id,v_org,p_program_id,(p_data->>'seasonId')::uuid,btrim(p_data->>'name'),(p_data->>'date')::date,
        (p_data->>'startTime')::time,(p_data->>'endTime')::time,(p_data->>'price')::numeric,p_data->>'location',auth.uid());
  else
    insert into public.players(id,organization_id,display_name,email,phone,status)
      values(p_id,v_org,btrim(p_data->>'name'),nullif(btrim(p_data->>'email'),''),nullif(btrim(p_data->>'phone'),''),'active');
    insert into public.program_members(organization_id,program_id,player_id,role,status)
      values(v_org,p_program_id,p_id,'member','active');
  end if;
  insert into public.audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,new_data)
    values(p_id,v_org,auth.uid(),'mobile_create_' || p_kind,p_kind,p_id,jsonb_build_object('program_id',p_program_id,'payload',p_data));
  return p_id;
end;
$$;
revoke all on function public.mobile_create_record(uuid,text,uuid,jsonb) from public,anon;
grant execute on function public.mobile_create_record(uuid,text,uuid,jsonb) to authenticated;

create or replace function public.mobile_credit_preview(p_program_id uuid,p_season_id uuid,p_player_id uuid)
returns text language plpgsql stable security definer set search_path=public as $$
declare v_credit numeric;
begin
  if not public.mobile_program_access(p_program_id) or public.program_role(p_program_id)<>'manager'
    or not public.can_manage_program_finance(p_program_id) then raise exception 'Manager finance access required'; end if;
  if not exists(select 1 from public.seasons s join public.players p on p.organization_id=s.organization_id
    where s.id=p_season_id and s.program_id=p_program_id and p.id=p_player_id) then raise exception 'Invalid season or player'; end if;
  select credit_amount into v_credit from public.player_season_payment_summary where season_id=p_season_id and player_id=p_player_id;
  return coalesce(v_credit,0)::numeric(12,2)::text;
end;
$$;
revoke all on function public.mobile_credit_preview(uuid,uuid,uuid) from public,anon;
grant execute on function public.mobile_credit_preview(uuid,uuid,uuid) to authenticated;

create or replace function public.mobile_member(p_program_id uuid,p_member_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_member jsonb;
begin
  if not public.mobile_program_access(p_program_id) or public.program_role(p_program_id)<>'manager'
    or not public.is_program_module_enabled(p_program_id,'members') then raise exception 'Manager access required'; end if;
  select jsonb_build_object('id',m.id,'name',coalesce(profile.display_name,player.display_name),
    'role',m.role,'status',m.status,'organizationStatus',om.status,'email',profile.email)
    into v_member from public.program_members m
    left join public.profiles profile on profile.id=m.profile_id
    left join public.players player on player.id=m.player_id
    left join public.organization_members om on om.organization_id=m.organization_id and om.profile_id=m.profile_id
    where m.id=p_member_id and m.program_id=p_program_id;
  if v_member is null then raise exception 'Member not found'; end if;
  return v_member;
end;
$$;
create or replace function public.mobile_update_member(p_program_id uuid,p_member_id uuid,p_role text,p_status text,p_approve_organization boolean default false)
returns void language plpgsql security definer set search_path=public as $$
declare v_member public.program_members%rowtype; v_org_role text; v_target_org_role text;
begin
  if not public.mobile_program_access(p_program_id) or public.program_role(p_program_id)<>'manager'
    or not public.is_program_module_enabled(p_program_id,'members') then raise exception 'Manager access required'; end if;
  if p_role is null or p_role not in ('manager','captain','member') or p_status is null or p_status not in ('pending','active','rejected','suspended') then raise exception 'Invalid role or status'; end if;
  select * into v_member from public.program_members where id=p_member_id and program_id=p_program_id for update;
  if not found or v_member.profile_id=auth.uid() then raise exception 'Cannot modify this membership'; end if;
  select role into v_org_role from public.organization_members where organization_id=v_member.organization_id and profile_id=auth.uid() and status='active';
  select role into v_target_org_role from public.organization_members where organization_id=v_member.organization_id and profile_id=v_member.profile_id;
  if v_target_org_role in ('owner','admin') then raise exception 'Organization administrators must be managed on the website'; end if;
  if v_org_role not in ('owner','admin') and (v_member.role='manager' or p_role='manager' or p_approve_organization) then raise exception 'Organization administrator required'; end if;
  if p_approve_organization then
    update public.organization_members set status='active' where organization_id=v_member.organization_id and profile_id=v_member.profile_id and role='player' and status='pending';
  end if;
  if p_status='active' and v_member.profile_id is not null and not exists(
    select 1 from public.organization_members where organization_id=v_member.organization_id and profile_id=v_member.profile_id and status='active'
  ) then raise exception 'Organization membership must be approved first'; end if;
  update public.program_members set role=p_role,status=p_status where id=p_member_id;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,old_data,new_data)
    values(v_member.organization_id,auth.uid(),'mobile_membership_updated','program_members',p_member_id,
      to_jsonb(v_member),jsonb_build_object('role',p_role,'status',p_status,'organization_approved',p_approve_organization));
end;
$$;
revoke all on function public.mobile_member(uuid,uuid),public.mobile_update_member(uuid,uuid,text,text,boolean) from public,anon;
grant execute on function public.mobile_member(uuid,uuid),public.mobile_update_member(uuid,uuid,text,text,boolean) to authenticated;
