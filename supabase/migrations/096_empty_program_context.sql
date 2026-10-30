-- A transaction-local setting is reset to an empty string on pooled connections.
-- Guard each cast itself: SQL does not guarantee AND/subquery evaluation order.
create or replace function public.organization_role(p_organization_id uuid default public.current_organization_id())
returns text language sql stable security definer set search_path = public as $$
  select case
    when public.has_platform_organization_access(p_organization_id) then 'admin'
    when organization.onboarding_status <> 'active' then null
    when nullif(current_setting('app.authorized_program_id', true), '') is not null and exists (
      select 1
      from public.programs authorized_program
      join public.program_members authorized_member on authorized_member.program_id = authorized_program.id
      where authorized_program.id = nullif(current_setting('app.authorized_program_id', true), '')::uuid
        and authorized_program.organization_id = p_organization_id
        and authorized_member.profile_id = auth.uid()
        and authorized_member.status = 'active'
        and authorized_member.role in ('manager', 'captain')
    ) then case when exists (
      select 1 from public.program_members authorized_member
      where authorized_member.program_id = nullif(current_setting('app.authorized_program_id', true), '')::uuid
        and authorized_member.profile_id = auth.uid()
        and authorized_member.status = 'active'
        and authorized_member.role = 'manager'
    ) then 'admin' else 'captain' end
    when member.role = 'owner' then 'admin'
    else member.role
  end
  from public.organizations organization
  left join public.organization_members member
    on member.organization_id = organization.id
   and member.profile_id = auth.uid()
   and member.status = 'active'
  where organization.id = p_organization_id
  limit 1;
$$;

