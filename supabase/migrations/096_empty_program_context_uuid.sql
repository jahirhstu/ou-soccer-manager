create or replace function public.organization_role(p_organization_id uuid default public.current_organization_id())
returns text
language sql
stable
security definer
set search_path = public
as $$
  with authorized_program as (
    select nullif(current_setting('app.authorized_program_id', true), '') as id
  )
  select case
    when public.has_platform_organization_access(p_organization_id) then 'admin'
    when organization.onboarding_status <> 'active' then null
    when authorized_program.id is not null and exists (
      select 1
      from public.programs p
      join public.program_members pm on pm.program_id = p.id
      where p.id::text = authorized_program.id
        and p.organization_id = p_organization_id
        and pm.profile_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('manager', 'captain')
    ) then case when exists (
      select 1
      from public.programs p
      join public.program_members pm on pm.program_id = p.id
      where p.id::text = authorized_program.id
        and pm.profile_id = auth.uid()
        and pm.status = 'active'
        and pm.role = 'manager'
    ) then 'admin' else 'captain' end
    when member.role = 'owner' then 'admin'
    else member.role
  end
  from authorized_program
  join public.organizations organization on organization.id = p_organization_id
  left join public.organization_members member
    on member.organization_id = organization.id
    and member.profile_id = auth.uid()
    and member.status = 'active'
  limit 1;
$$;
