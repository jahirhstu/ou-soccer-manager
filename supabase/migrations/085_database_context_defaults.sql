alter table public.organizations
  add column if not exists is_default boolean not null default false;

alter table public.programs
  add column if not exists is_default boolean not null default false;

alter table public.profiles
  add column if not exists default_organization_id uuid references public.organizations(id) on delete set null,
  add column if not exists default_program_id uuid references public.programs(id) on delete set null;

create unique index if not exists organizations_single_default_idx
  on public.organizations (is_default)
  where is_default;

create unique index if not exists programs_single_default_per_organization_idx
  on public.programs (organization_id)
  where is_default;

create or replace function public.validate_profile_default_context()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.default_program_id is not null and new.default_organization_id is null then
    raise exception 'A default program requires a default organization';
  end if;
  if new.default_program_id is not null and not exists (
    select 1 from public.programs program
    where program.id = new.default_program_id
      and program.organization_id = new.default_organization_id
      and program.status = 'active'
  ) then
    raise exception 'Default program does not belong to the default organization';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_profile_default_context on public.profiles;
create trigger validate_profile_default_context
before insert or update of default_organization_id, default_program_id on public.profiles
for each row execute function public.validate_profile_default_context();

create or replace function public.resolve_default_route_context(p_organization_slug text default null)
returns table (organization_slug text, program_slug text)
language sql
stable
security definer
set search_path = public
as $$
  select organization.slug, program.slug
  from public.organizations organization
  left join public.programs program
    on program.organization_id = organization.id
   and program.is_default
   and program.status = 'active'
  where organization.public_reports_enabled
    and (
      (nullif(public.normalize_slug(p_organization_slug), '') is null and organization.is_default)
      or organization.slug = public.normalize_slug(p_organization_slug)
    )
  order by organization.is_default desc
  limit 1;
$$;

create or replace function public.get_my_default_context()
returns table (organization_slug text, program_slug text)
language sql
stable
security definer
set search_path = public
as $$
  select organization.slug, program.slug
  from public.profiles profile
  join public.organizations organization on organization.id = profile.default_organization_id
  join public.organization_members membership
    on membership.organization_id = organization.id
   and membership.profile_id = profile.id
   and membership.status = 'active'
  left join public.programs program
    on program.id = profile.default_program_id
   and program.organization_id = organization.id
   and program.status = 'active'
  where profile.id = auth.uid()
    and (
      program.id is null
      or membership.role in ('owner', 'admin')
      or exists (
        select 1 from public.program_members program_membership
        where program_membership.profile_id = profile.id
          and program_membership.program_id = program.id
          and program_membership.status = 'active'
      )
    )
  limit 1;
$$;

create or replace function public.set_my_default_context(
  p_organization_id uuid,
  p_program_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  membership_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select membership.role into membership_role
  from public.organization_members membership
  where membership.organization_id = p_organization_id
    and membership.profile_id = auth.uid()
    and membership.status = 'active';
  if membership_role is null then raise exception 'Active organization membership required'; end if;

  if p_program_id is not null then
    if not exists (
      select 1 from public.programs program
      where program.id = p_program_id
        and program.organization_id = p_organization_id
        and program.status = 'active'
    ) then raise exception 'Program does not belong to this organization'; end if;

    if membership_role not in ('owner', 'admin') and not exists (
      select 1 from public.program_members program_membership
      where program_membership.profile_id = auth.uid()
        and program_membership.program_id = p_program_id
        and program_membership.status = 'active'
    ) then raise exception 'Active program membership required'; end if;
  end if;

  update public.profiles
  set default_organization_id = p_organization_id,
      default_program_id = p_program_id
  where id = auth.uid();
end;
$$;

create or replace function public.set_platform_default_context(
  p_organization_id uuid,
  p_program_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.platform_accounts
    where profile_id = auth.uid() and role = 'platform_owner'
  ) then raise exception 'Only the platform owner can set the public default context'; end if;

  if not exists (
    select 1 from public.programs
    where id = p_program_id
      and organization_id = p_organization_id
      and status = 'active'
  ) then raise exception 'Program does not belong to this organization'; end if;

  update public.programs set is_default = false
  where organization_id = p_organization_id and is_default;
  update public.organizations set is_default = false where is_default;
  update public.organizations set is_default = true where id = p_organization_id;
  update public.programs set is_default = true where id = p_program_id;
end;
$$;

create or replace function public.set_organization_default_program(p_program_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organization_id uuid;
begin
  select program.organization_id into v_organization_id
  from public.programs program
  where program.id = p_program_id and program.status = 'active';
  if v_organization_id is null then raise exception 'Active program not found'; end if;
  if public.organization_role(v_organization_id) <> 'admin' then
    raise exception 'Organization admin access required';
  end if;
  update public.programs set is_default = false
  where programs.organization_id = v_organization_id and is_default;
  update public.programs set is_default = true where id = p_program_id;
end;
$$;

revoke all on function public.get_my_default_context() from public, anon;
revoke all on function public.set_my_default_context(uuid, uuid) from public, anon;
revoke all on function public.set_platform_default_context(uuid, uuid) from public, anon;
revoke all on function public.set_organization_default_program(uuid) from public, anon;
grant execute on function public.resolve_default_route_context(text) to anon, authenticated;
grant execute on function public.get_my_default_context() to authenticated;
grant execute on function public.set_my_default_context(uuid, uuid) to authenticated;
grant execute on function public.set_platform_default_context(uuid, uuid) to authenticated;
grant execute on function public.set_organization_default_program(uuid) to authenticated;
