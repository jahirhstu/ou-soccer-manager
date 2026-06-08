create or replace function public.ensure_membership_for_slug(p_slug text, p_role text default 'player')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  org_id uuid;
  profile_id uuid := auth.uid();
  normalized_role text := coalesce(p_role, 'player');
begin
  if profile_id is null then
    raise exception 'You must be logged in to join an organization.';
  end if;

  if normalized_role not in ('owner', 'admin', 'captain', 'player') then
    raise exception 'Invalid organization role.';
  end if;

  select id into org_id
  from public.organizations
  where slug = public.normalize_slug(p_slug)
  limit 1;

  if org_id is null then
    raise exception 'Organization not found for this signup URL.';
  end if;

  insert into public.organization_members(organization_id, profile_id, role, player_id)
  values (org_id, profile_id, normalized_role, null)
  on conflict (organization_id, profile_id) do nothing;

  return org_id;
end;
$$;

grant execute on function public.ensure_membership_for_slug(text, text) to authenticated;
