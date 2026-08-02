-- Supabase installs pgcrypto in the extensions schema. Schema-qualify digest
-- so invitation acceptance works with the function's restricted search_path.

create or replace function public.accept_invitation(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_profile_id uuid := auth.uid();
  v_email text;
  invitation public.invitations%rowtype;
begin
  if v_profile_id is null then raise exception 'Authentication required'; end if;
  select lower(email) into v_email from public.profiles where id = v_profile_id;
  select * into invitation from public.invitations
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  for update;
  if not found or invitation.status <> 'active' or invitation.expires_at <= now()
     or invitation.used_count >= invitation.max_uses then
    raise exception 'Invitation is invalid or expired';
  end if;
  if invitation.email is not null and lower(invitation.email) <> v_email then
    raise exception 'Invitation belongs to a different email address';
  end if;
  if not exists (
    select 1 from public.organizations organization
    where organization.id = invitation.organization_id
      and organization.onboarding_status = 'active'
  ) then raise exception 'Organization is not active'; end if;

  insert into public.organization_members(organization_id, profile_id, role, status)
  values (invitation.organization_id, v_profile_id, coalesce(invitation.organization_role, 'player'), 'active')
  on conflict (organization_id, profile_id) do update set
    status = 'active',
    role = case
      when invitation.organization_role in ('owner', 'admin') then invitation.organization_role
      else public.organization_members.role
    end;

  if invitation.program_id is not null then
    insert into public.program_members(organization_id, program_id, profile_id, role, status)
    values (invitation.organization_id, invitation.program_id, v_profile_id, coalesce(invitation.program_role, 'member'), 'active')
    on conflict (program_id, profile_id) where profile_id is not null do update set
      status = 'active',
      role = coalesce(invitation.program_role, public.program_members.role);
  end if;

  update public.invitations set
    used_count = used_count + 1,
    status = case when used_count + 1 >= max_uses then 'consumed' else status end,
    updated_at = now()
  where id = invitation.id;
  return jsonb_build_object('organizationId', invitation.organization_id, 'programId', invitation.program_id);
end;
$$;

revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;
