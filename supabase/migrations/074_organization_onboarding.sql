-- Platform-managed organization onboarding, normalized module templates, and
-- first-owner invitations.

create table if not exists public.module_catalog (
  key text primary key check (key = public.normalize_slug(replace(key, '_', '-')) or key ~ '^[a-z0-9_]+$'),
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.program_template_modules (
  program_template_id uuid not null references public.program_templates(id) on delete cascade,
  module_key text not null references public.module_catalog(key) on delete restrict,
  default_enabled boolean not null default true,
  required boolean not null default false,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (program_template_id, module_key),
  check (not required or default_enabled)
);

insert into public.module_catalog(key, name) values
  ('members', 'Members'),
  ('activities', 'Activities'),
  ('attendance', 'Attendance'),
  ('payments', 'Payments'),
  ('expenses', 'Expenses'),
  ('teams', 'Teams'),
  ('scores', 'Scores'),
  ('fixtures', 'Fixtures'),
  ('leaderboards', 'Leaderboards'),
  ('goals_assists', 'Goals and assists'),
  ('whatsapp_import', 'WhatsApp import'),
  ('public_reports', 'Public reports'),
  ('rsvp', 'RSVP'),
  ('tasks', 'Tasks'),
  ('budget_summary', 'Budget summary')
on conflict (key) do update set name = excluded.name;

insert into public.program_template_modules(program_template_id, module_key, default_enabled, required, display_order)
select
  template.id,
  module_key,
  true,
  module_key in ('members', 'activities'),
  module_order
from public.program_templates template
cross join lateral unnest(template.default_modules) with ordinality modules(module_key, module_order)
on conflict (program_template_id, module_key) do update set
  default_enabled = excluded.default_enabled,
  required = excluded.required,
  display_order = excluded.display_order;

insert into public.module_catalog(key, name)
select distinct module.module_key, initcap(replace(module.module_key, '_', ' '))
from public.program_modules module
where module.module_key ~ '^[a-z0-9_]+$'
on conflict (key) do nothing;

insert into public.program_template_modules(program_template_id, module_key, default_enabled, required, display_order)
select distinct
  program.program_template_id,
  module.module_key,
  bool_or(module.enabled),
  false,
  1000
from public.program_modules module
join public.programs program on program.id = module.program_id
where program.program_template_id is not null
group by program.program_template_id, module.module_key
on conflict (program_template_id, module_key) do nothing;

alter table public.organizations
  add column if not exists onboarding_status text not null default 'active';
alter table public.organizations drop constraint if exists organizations_onboarding_status_check;
alter table public.organizations add constraint organizations_onboarding_status_check
  check (onboarding_status in ('provisioning', 'active', 'suspended'));

alter table public.organizations add column if not exists onboarded_by uuid references public.profiles(id);

alter table public.invitations drop constraint if exists invitations_organization_role_check;
alter table public.invitations add constraint invitations_organization_role_check
  check (organization_role in ('owner', 'admin', 'player'));

create or replace function public.is_organization_member(p_organization_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_platform_organization_access(p_organization_id)
    or exists (
      select 1
      from public.organization_members member
      join public.organizations organization on organization.id = member.organization_id
      where member.organization_id = p_organization_id
        and member.profile_id = auth.uid()
        and member.status = 'active'
        and organization.onboarding_status = 'active'
    );
$$;

create or replace function public.current_organization_id()
returns uuid language sql stable security definer set search_path = public as $$
  select member.organization_id
  from public.organization_members member
  join public.organizations organization on organization.id = member.organization_id
  where member.profile_id = auth.uid()
    and member.status = 'active'
    and organization.onboarding_status = 'active'
  order by case member.role when 'owner' then 1 when 'admin' then 2 else 3 end, member.created_at
  limit 1;
$$;

create or replace function public.organization_role(p_organization_id uuid default public.current_organization_id())
returns text language sql stable security definer set search_path = public as $$
  select case
    when public.has_platform_organization_access(p_organization_id) then 'admin'
    when organization.onboarding_status <> 'active' then null
    when nullif(current_setting('app.authorized_program_id', true), '') is not null and exists (
      select 1
      from public.programs authorized_program
      join public.program_members authorized_member on authorized_member.program_id = authorized_program.id
      where authorized_program.id = current_setting('app.authorized_program_id', true)::uuid
        and authorized_program.organization_id = p_organization_id
        and authorized_member.profile_id = auth.uid()
        and authorized_member.status = 'active'
        and authorized_member.role in ('manager', 'captain')
    ) then case when exists (
      select 1 from public.program_members authorized_member
      where authorized_member.program_id = current_setting('app.authorized_program_id', true)::uuid
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

alter table public.module_catalog enable row level security;
alter table public.program_template_modules enable row level security;

create policy "module_catalog_read" on public.module_catalog for select using (true);
create policy "module_catalog_owner_all" on public.module_catalog
  for all using (public.platform_role() = 'platform_owner')
  with check (public.platform_role() = 'platform_owner');
create policy "template_modules_read" on public.program_template_modules for select using (true);
create policy "template_modules_owner_all" on public.program_template_modules
  for all using (public.platform_role() = 'platform_owner')
  with check (public.platform_role() = 'platform_owner');

drop trigger if exists module_catalog_updated_at on public.module_catalog;
create trigger module_catalog_updated_at before update on public.module_catalog
for each row execute function public.set_updated_at();
drop trigger if exists program_template_modules_updated_at on public.program_template_modules;
create trigger program_template_modules_updated_at before update on public.program_template_modules
for each row execute function public.set_updated_at();

create or replace function public.validate_program_module_assignment()
returns trigger language plpgsql set search_path = public as $$
declare
  v_template_id uuid;
  v_required boolean;
begin
  select program_template_id into v_template_id
  from public.programs
  where id = new.program_id and organization_id = new.organization_id;

  if v_template_id is null or not exists (
    select 1
    from public.program_template_modules template_module
    where template_module.program_template_id = v_template_id
      and template_module.module_key = new.module_key
  ) then
    raise exception 'Module is not available for this program template';
  end if;

  select required into v_required
  from public.program_template_modules
  where program_template_id = v_template_id and module_key = new.module_key;
  if v_required and not new.enabled then
    raise exception 'Required program modules cannot be disabled';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_program_module_assignment on public.program_modules;
create trigger validate_program_module_assignment
before insert or update on public.program_modules
for each row execute function public.validate_program_module_assignment();

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
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
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

create or replace function public.create_organization_onboarding(
  p_name text,
  p_slug text,
  p_organization_category text,
  p_currency_code text,
  p_timezone text,
  p_programs jsonb,
  p_owner_email text,
  p_owner_token_hash text,
  p_owner_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_platform_role text;
  v_organization_id uuid;
  v_program_id uuid;
  v_default_program_id uuid;
  v_invitation_id uuid;
  v_program jsonb;
  v_template public.program_templates%rowtype;
  v_module_key text;
  v_requested_modules text[];
  v_program_ids jsonb := '[]'::jsonb;
begin
  if v_actor_id is null then raise exception 'Authentication required'; end if;
  select role into v_platform_role from public.platform_accounts where profile_id = v_actor_id;
  if v_platform_role not in ('platform_owner', 'platform_superadmin') then
    raise exception 'Platform administration required';
  end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Organization name is required'; end if;
  if public.normalize_slug(p_slug) <> p_slug or length(p_slug) = 0 then raise exception 'Invalid organization slug'; end if;
  if p_organization_category not in ('sports_club', 'event_group', 'community_group', 'social_group', 'generic') then
    raise exception 'Invalid organization category';
  end if;
  if p_currency_code !~ '^[A-Z]{3}$' then raise exception 'Invalid currency code'; end if;
  if coalesce(jsonb_typeof(p_programs), '') <> 'array' or jsonb_array_length(p_programs) = 0 then
    raise exception 'At least one program is required';
  end if;
  if lower(trim(coalesce(p_owner_email, ''))) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'A valid owner email is required';
  end if;
  if p_owner_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid invitation token'; end if;
  if p_owner_expires_at <= now() then raise exception 'Invitation expiry must be in the future'; end if;

  insert into public.organizations(
    name, slug, created_by, onboarded_by, public_reports_enabled, onboarding_status
  ) values (
    trim(p_name), p_slug, v_actor_id, v_actor_id, false, 'provisioning'
  ) returning id into v_organization_id;

  insert into public.organization_settings(
    organization_id, organization_category, currency_code, timezone
  ) values (
    v_organization_id, p_organization_category, p_currency_code, p_timezone
  );

  if v_platform_role = 'platform_superadmin' then
    insert into public.platform_admin_organization_access(profile_id, organization_id)
    values (v_actor_id, v_organization_id)
    on conflict do nothing;
  end if;

  for v_program in select value from jsonb_array_elements(p_programs)
  loop
    select * into v_template
    from public.program_templates
    where id = nullif(v_program->>'templateId', '')::uuid and status = 'active';
    if not found then raise exception 'Active program template not found'; end if;

    insert into public.organization_enabled_programs(
      organization_id, program_template_id, enabled, enabled_by
    ) values (
      v_organization_id, v_template.id, true, v_actor_id
    ) on conflict (organization_id, program_template_id) do update set
      enabled = true, enabled_by = excluded.enabled_by, updated_at = now();

    insert into public.programs(
      organization_id, program_template_id, name, slug, category,
      activity_type, status, created_by, is_default
    ) values (
      v_organization_id,
      v_template.id,
      trim(v_program->>'name'),
      public.normalize_slug(v_program->>'slug'),
      v_template.category,
      v_template.key,
      'active',
      v_actor_id,
      coalesce((v_program->>'isDefault')::boolean, false)
    ) returning id into v_program_id;

    select coalesce(array_agg(value), '{}'::text[]) into v_requested_modules
    from jsonb_array_elements_text(coalesce(v_program->'modules', '[]'::jsonb));

    if exists (
      select 1 from unnest(v_requested_modules) requested(module_key)
      where not exists (
        select 1 from public.program_template_modules available
        where available.program_template_id = v_template.id
          and available.module_key = requested.module_key
      )
    ) then raise exception 'A selected module does not belong to its program template'; end if;

    if exists (
      select 1 from public.program_template_modules required_module
      where required_module.program_template_id = v_template.id
        and required_module.required
        and not required_module.module_key = any(v_requested_modules)
    ) then raise exception 'All required template modules must be selected'; end if;

    insert into public.program_modules(organization_id, program_id, module_key, enabled)
    select
      v_organization_id,
      v_program_id,
      template_module.module_key,
      template_module.module_key = any(v_requested_modules)
    from public.program_template_modules template_module
    where template_module.program_template_id = v_template.id;

    if coalesce((v_program->>'isDefault')::boolean, false) then
      if v_default_program_id is not null then raise exception 'Only one default program may be selected'; end if;
      v_default_program_id := v_program_id;
    end if;
    v_program_ids := v_program_ids || jsonb_build_array(v_program_id);
  end loop;

  if v_default_program_id is null then
    v_default_program_id := (v_program_ids->>0)::uuid;
    update public.programs set is_default = true where id = v_default_program_id;
  end if;

  insert into public.invitations(
    token_hash, organization_id, program_id, organization_role, program_role,
    email, expires_at, max_uses, created_by
  ) values (
    p_owner_token_hash, v_organization_id, v_default_program_id, 'owner', 'manager',
    lower(trim(p_owner_email)), p_owner_expires_at, 1, v_actor_id
  ) returning id into v_invitation_id;

  update public.organizations set onboarding_status = 'active' where id = v_organization_id;

  insert into public.audit_logs(actor_id, organization_id, action, entity_type, entity_id, new_data)
  values (
    v_actor_id,
    v_organization_id,
    'organization.onboarded',
    'organization',
    v_organization_id,
    jsonb_build_object(
      'programIds', v_program_ids,
      'ownerEmail', lower(trim(p_owner_email)),
      'invitationId', v_invitation_id
    )
  );

  return jsonb_build_object(
    'organizationId', v_organization_id,
    'programIds', v_program_ids,
    'invitationId', v_invitation_id
  );
end;
$$;

revoke all on function public.create_organization_onboarding(
  text, text, text, text, text, jsonb, text, text, timestamptz
) from public, anon;
grant execute on function public.create_organization_onboarding(
  text, text, text, text, text, jsonb, text, text, timestamptz
) to authenticated;

create or replace function public.create_program_template(
  p_key text,
  p_name text,
  p_category text,
  p_modules text[],
  p_required_modules text[] default array['members', 'activities']::text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template_id uuid;
  v_module_key text;
  v_order integer := 0;
begin
  if public.platform_role() <> 'platform_owner' then
    raise exception 'Only the platform owner can create program templates';
  end if;
  if public.normalize_slug(p_key) <> p_key or length(p_key) = 0 then raise exception 'Invalid template key'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Template name is required'; end if;
  if p_category not in ('sport', 'event', 'social', 'generic') then raise exception 'Invalid template category'; end if;
  if coalesce(array_length(p_modules, 1), 0) = 0 then raise exception 'Select at least one module'; end if;
  if not p_required_modules <@ p_modules then raise exception 'Required modules must be selected'; end if;
  if exists (
    select 1 from unnest(p_modules) selected(module_key)
    where not exists (select 1 from public.module_catalog catalog where catalog.key = selected.module_key and catalog.status = 'active')
  ) then raise exception 'Unknown or archived module selected'; end if;

  insert into public.program_templates(key, name, category, default_modules)
  values (p_key, trim(p_name), p_category, p_modules)
  returning id into v_template_id;

  foreach v_module_key in array p_modules loop
    v_order := v_order + 1;
    insert into public.program_template_modules(
      program_template_id, module_key, default_enabled, required, display_order
    ) values (
      v_template_id, v_module_key, true, v_module_key = any(p_required_modules), v_order
    );
  end loop;
  return v_template_id;
end;
$$;

revoke all on function public.create_program_template(text, text, text, text[], text[]) from public, anon;
grant execute on function public.create_program_template(text, text, text, text[], text[]) to authenticated;

create index if not exists program_template_modules_template_order_idx
  on public.program_template_modules(program_template_id, display_order);
create index if not exists organizations_onboarding_status_idx
  on public.organizations(onboarding_status);
