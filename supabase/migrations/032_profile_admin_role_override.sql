create or replace function public.organization_role(p_organization_id uuid default public.current_organization_id())
returns text language sql stable security definer set search_path = public as $$
  select case
    when p.role = 'admin' then 'admin'
    when om.role = 'owner' then 'admin'
    else om.role
  end
  from public.organization_members om
  join public.profiles p on p.id = om.profile_id
  where om.organization_id = p_organization_id
    and om.profile_id = auth.uid()
  limit 1;
$$;

update public.organization_members om
set role = 'owner'
from public.profiles p
where p.id = om.profile_id
  and p.role = 'admin'
  and om.role <> 'owner';
