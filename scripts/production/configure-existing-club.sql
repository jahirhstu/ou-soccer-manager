-- Called only by the guarded rehearsal runner, with verified UUIDs in local settings.
do $$
declare
  org uuid := current_setting('rehearsal.organization_id')::uuid;
  program uuid := current_setting('rehearsal.program_id')::uuid;
  owner_id uuid := current_setting('rehearsal.owner_id')::uuid;
begin
  if not exists(select 1 from public.organization_members where organization_id=org and profile_id=owner_id and role='owner') then
    raise exception 'Confirmed owner is no longer an organization owner';
  end if;
  if not exists(select 1 from public.programs where id=program and organization_id=org and status='active') then
    raise exception 'Confirmed soccer program is unavailable';
  end if;
  insert into public.platform_accounts(profile_id,role) values(owner_id,'platform_owner')
    on conflict(profile_id) do update set role='platform_owner';
  update public.organizations set is_default=(id=org);
  update public.programs set is_default=(id=program) where organization_id=org;
  update public.organization_settings set public_balances_enabled=true,public_payments_enabled=true where organization_id=org;

  -- Existing player links win: never take a player identity from another login.
  insert into public.program_members(organization_id,program_id,profile_id,player_id,role,status)
  select org,program,m.profile_id,
    case when not exists(select 1 from public.program_members occupied where occupied.program_id=program and occupied.player_id=m.player_id)
      and (m.player_id is null or (select count(*) from public.organization_members dup where dup.organization_id=org and dup.player_id=m.player_id)=1)
      then m.player_id else null end,
    case when m.role in ('owner','admin') then 'manager' when m.role='captain' then 'captain' else 'member' end,'active'
  from public.organization_members m
  where m.organization_id=org and m.status='active'
    and not exists(select 1 from public.program_members pm where pm.program_id=program and pm.profile_id=m.profile_id);
  update public.program_members pm set role='captain'
  from public.organization_members om where om.profile_id=pm.profile_id and om.organization_id=org
    and pm.program_id=program and om.role='captain' and pm.role='member' and om.status='active';
  update public.profiles p set default_organization_id=org,default_program_id=program
  where exists(select 1 from public.organization_members m where m.profile_id=p.id and m.organization_id=org and m.status='active');

  insert into public.module_catalog(key,name) values('leagues','Leagues') on conflict(key) do nothing;
  insert into public.program_template_modules(program_template_id,module_key,default_enabled,required)
    select program_template_id,'leagues',true,false from public.programs where id=program
    on conflict do nothing;
  insert into public.program_modules(organization_id,program_id,module_key,enabled)
    select org,program,module_key,true from unnest(array['whatsapp_import','public_reports','leagues']) as module_key
    on conflict(program_id,module_key) do nothing;
end;
$$;
