-- REVIEW ONLY. Run after 081-095 within the verified release transaction.
-- The runner must supply reviewed release.organization_id and release.program_id.
-- No platform-owner grants, privacy changes, or existing role changes.
do $$
declare
  org uuid := current_setting('release.organization_id')::uuid;
  program uuid := current_setting('release.program_id')::uuid;
begin
  if not exists(select 1 from public.programs where id=program and organization_id=org and status='active') then
    raise exception 'Reviewed program is not active in the reviewed organization';
  end if;
  if exists(select 1 from public.organizations where is_default and id<>org)
    or exists(select 1 from public.programs where organization_id=org and is_default and id<>program) then
    raise exception 'Existing defaults conflict; review rather than overwrite';
  end if;
  update public.organizations set is_default=true where id=org and not is_default;
  update public.programs set is_default=true where id=program and not is_default;
  insert into public.program_members(organization_id,program_id,profile_id,player_id,role,status)
  select org,program,m.profile_id,
    case when m.player_id is not null
      and (select count(*) from public.organization_members linked
        where linked.organization_id=org and linked.player_id=m.player_id)=1
      and not exists(select 1 from public.program_members occupied
        where occupied.program_id=program and occupied.player_id=m.player_id)
      then m.player_id else null end,
    case when m.role in ('owner','admin') then 'manager' when m.role='captain' then 'captain' else 'member' end,'active'
  from public.organization_members m
  where m.organization_id=org and m.status='active'
    and not exists(select 1 from public.program_members pm where pm.program_id=program and pm.profile_id=m.profile_id);
  update public.profiles p set default_organization_id=org,default_program_id=program
  where p.default_organization_id is null and p.default_program_id is null
    and exists(select 1 from public.program_members pm where pm.profile_id=p.id and pm.program_id=program and pm.status='active');
  if exists(select 1 from public.development_refresh_targets where enabled) then
    raise exception 'Development refresh must not be enabled in production';
  end if;
end $$;
