create extension if not exists pgcrypto;

-- Platform authority is deliberately separate from organization membership.
create table if not exists public.platform_accounts (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null check (role in ('platform_owner', 'platform_superadmin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_admin_organization_access (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, organization_id)
);

insert into public.platform_accounts(profile_id, role)
select om.profile_id, 'platform_owner'
from public.organization_members om
where om.role = 'owner'
order by om.created_at
limit 1
on conflict (profile_id) do nothing;

create or replace function public.platform_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.platform_accounts where profile_id = auth.uid();
$$;

create or replace function public.has_platform_organization_access(p_organization_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.platform_role() = 'platform_owner'
    or exists (
      select 1 from public.platform_admin_organization_access access
      where access.profile_id = auth.uid()
        and access.organization_id = p_organization_id
    );
$$;

alter table public.platform_accounts enable row level security;
alter table public.platform_admin_organization_access enable row level security;
create policy "platform_accounts_self_select" on public.platform_accounts
  for select using (profile_id = auth.uid() or public.platform_role() = 'platform_owner');
create policy "platform_accounts_owner_all" on public.platform_accounts
  for all using (public.platform_role() = 'platform_owner')
  with check (public.platform_role() = 'platform_owner');
create policy "platform_access_self_select" on public.platform_admin_organization_access
  for select using (profile_id = auth.uid() or public.platform_role() = 'platform_owner');
create policy "platform_access_owner_all" on public.platform_admin_organization_access
  for all using (public.platform_role() = 'platform_owner')
  with check (public.platform_role() = 'platform_owner');
create policy "profiles_platform_owner_select" on public.profiles
  for select using (public.platform_role() = 'platform_owner');

-- Templates are global definitions; programs remain organization-owned instances.
create table if not exists public.program_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key = public.normalize_slug(key) and length(key) > 0),
  name text not null,
  category text not null check (category in ('sport', 'event', 'social', 'generic')),
  default_modules text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_enabled_programs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  program_template_id uuid not null references public.program_templates(id) on delete cascade,
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  enabled_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, program_template_id)
);

insert into public.program_templates(key, name, category, default_modules) values
  ('soccer', 'Soccer', 'sport', array['members','activities','attendance','payments','expenses','teams','scores','fixtures','leaderboards','goals_assists','whatsapp_import','public_reports']),
  ('cricket', 'Cricket', 'sport', array['members','activities','attendance','payments','expenses']),
  ('community-event', 'Community Event', 'event', array['members','activities','rsvp','payments','expenses','tasks']),
  ('training', 'Training', 'generic', array['members','activities','attendance']),
  ('technical-activity', 'Technical Activity', 'generic', array['members','activities','attendance'])
on conflict (key) do update set
  name = excluded.name,
  category = excluded.category,
  default_modules = excluded.default_modules;

alter table public.programs add column if not exists program_template_id uuid references public.program_templates(id) on delete restrict;

insert into public.organization_enabled_programs(organization_id, program_template_id)
select distinct p.organization_id, template.id
from public.programs p
join public.program_templates template on template.key = public.normalize_slug(p.activity_type)
on conflict (organization_id, program_template_id) do nothing;

update public.programs p
set program_template_id = template.id
from public.program_templates template
where p.program_template_id is null
  and template.key = public.normalize_slug(p.activity_type);

insert into public.program_modules(organization_id, program_id, module_key, enabled)
select organization_id, id, 'public_reports', true from public.programs
on conflict (program_id, module_key) do nothing;

alter table public.program_templates enable row level security;
alter table public.organization_enabled_programs enable row level security;
create policy "program_templates_read" on public.program_templates for select using (true);
create policy "program_templates_owner_all" on public.program_templates
  for all using (public.platform_role() = 'platform_owner')
  with check (public.platform_role() = 'platform_owner');
create policy "enabled_programs_member_select" on public.organization_enabled_programs
  for select using (public.is_organization_member(organization_id) or public.has_platform_organization_access(organization_id));
create policy "enabled_programs_platform_all" on public.organization_enabled_programs
  for all using (public.has_platform_organization_access(organization_id))
  with check (public.has_platform_organization_access(organization_id));

-- Public enrollment is a request. Privileged roles are only granted by invitations/admins.
alter table public.organization_members add column if not exists status text not null default 'active';
alter table public.organization_members drop constraint if exists organization_members_status_check;
alter table public.organization_members add constraint organization_members_status_check
  check (status in ('pending', 'active', 'rejected', 'suspended'));
alter table public.program_members add column if not exists status text not null default 'active';
alter table public.program_members drop constraint if exists program_members_status_check;
alter table public.program_members add constraint program_members_status_check
  check (status in ('pending', 'active', 'rejected', 'suspended'));
create policy "organization_members_self_select" on public.organization_members
  for select using (profile_id = auth.uid());
create policy "program_members_self_select" on public.program_members
  for select using (profile_id = auth.uid());

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  program_id uuid references public.programs(id) on delete cascade,
  organization_role text check (organization_role in ('admin', 'player')),
  program_role text check (program_role in ('manager', 'captain', 'member')),
  email text,
  phone text,
  expires_at timestamptz not null,
  max_uses integer not null default 1 check (max_uses > 0),
  used_count integer not null default 0 check (used_count >= 0),
  created_by uuid not null references public.profiles(id),
  status text not null default 'active' check (status in ('active', 'revoked', 'expired', 'consumed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (organization_role is not null or program_role is not null)
);

alter table public.invitations enable row level security;
create policy "invitations_admin_select" on public.invitations for select using (
  public.organization_role(organization_id) = 'admin' or public.has_platform_organization_access(organization_id)
);
create policy "invitations_admin_all" on public.invitations for all using (
  public.organization_role(organization_id) = 'admin' or public.has_platform_organization_access(organization_id)
) with check (
  public.organization_role(organization_id) = 'admin' or public.has_platform_organization_access(organization_id)
);

create or replace function public.request_membership_for_slug(p_organization_slug text, p_program_slug text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_profile_id uuid := auth.uid();
  v_organization_id uuid;
  v_program_id uuid;
begin
  if v_profile_id is null then raise exception 'Authentication required'; end if;
  select id into v_organization_id from public.organizations
  where slug = public.normalize_slug(p_organization_slug);
  if v_organization_id is null then raise exception 'Organization not found'; end if;

  insert into public.organization_members(organization_id, profile_id, role, status)
  values (v_organization_id, v_profile_id, 'player', 'pending')
  on conflict (organization_id, profile_id) do nothing;

  if nullif(public.normalize_slug(p_program_slug), '') is not null then
    select id into v_program_id from public.programs
    where organization_id = v_organization_id
      and slug = public.normalize_slug(p_program_slug)
      and status = 'active';
    if v_program_id is null then raise exception 'Program not found'; end if;
    insert into public.program_members(organization_id, program_id, profile_id, role, status)
    values (v_organization_id, v_program_id, v_profile_id, 'member', 'pending')
    on conflict do nothing;
  end if;
  return v_organization_id;
end;
$$;

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

  insert into public.organization_members(organization_id, profile_id, role, status)
  values (invitation.organization_id, v_profile_id, coalesce(invitation.organization_role, 'player'), 'active')
  on conflict (organization_id, profile_id) do update set
    status = 'active',
    role = case when invitation.organization_role = 'admin' then 'admin' else public.organization_members.role end;

  if invitation.program_id is not null then
    insert into public.program_members(organization_id, program_id, profile_id, role, status)
    values (invitation.organization_id, invitation.program_id, v_profile_id, coalesce(invitation.program_role, 'member'), 'active')
    on conflict do nothing;
    update public.program_members set status = 'active', role = coalesce(invitation.program_role, role)
    where program_id = invitation.program_id and profile_id = v_profile_id;
  end if;

  update public.invitations set
    used_count = used_count + 1,
    status = case when used_count + 1 >= max_uses then 'consumed' else status end,
    updated_at = now()
  where id = invitation.id;
  return jsonb_build_object('organizationId', invitation.organization_id, 'programId', invitation.program_id);
end;
$$;

-- Auth-trigger enrollment works even when email confirmation means signUp returns no session.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_organization_slug text := public.normalize_slug(new.raw_user_meta_data->>'organization_slug');
  v_program_slug text := public.normalize_slug(new.raw_user_meta_data->>'program_slug');
  v_organization_id uuid;
  v_program_id uuid;
begin
  insert into public.profiles(id, display_name, email, role)
  values(new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)), new.email, 'player')
  on conflict (id) do nothing;
  if nullif(v_organization_slug, '') is null then return new; end if;
  select id into v_organization_id from public.organizations where slug = v_organization_slug;
  if v_organization_id is null then return new; end if;
  insert into public.organization_members(organization_id, profile_id, role, status)
  values (v_organization_id, new.id, 'player', 'pending')
  on conflict (organization_id, profile_id) do nothing;
  if nullif(v_program_slug, '') is not null then
    select id into v_program_id from public.programs
    where organization_id = v_organization_id and slug = v_program_slug and status = 'active';
    if v_program_id is not null then
      insert into public.program_members(organization_id, program_id, profile_id, role, status)
      values (v_organization_id, v_program_id, new.id, 'member', 'pending')
      on conflict do nothing;
    end if;
  end if;
  return new;
end;
$$;

-- Reject mismatched organization/program pairs, including writes made by definer RPCs.
create or replace function public.validate_organization_program_scope()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.program_id is not null and not exists (
    select 1 from public.programs p where p.id = new.program_id and p.organization_id = new.organization_id
  ) then raise exception 'Program does not belong to organization'; end if;
  return new;
end;
$$;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'program_modules','program_members','seasons','sessions','payments','attendance','dropouts',
    'ledger_entries','session_player_charges','session_teams','session_team_players','session_matches',
    'goals','leagues','league_teams','league_team_players','league_matches','club_expenses',
    'player_performance_ratings','invitations'
  ] loop
    if to_regclass('public.' || v_table) is not null then
      execute format('drop trigger if exists validate_organization_program_scope on public.%I', v_table);
      execute format('create trigger validate_organization_program_scope before insert or update on public.%I for each row execute function public.validate_organization_program_scope()', v_table);
    end if;
  end loop;
end $$;

-- Definer functions are not capabilities unless explicitly granted.
revoke all on function public.ensure_default_membership(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.ensure_default_program(uuid) from public, anon, authenticated;
revoke all on function public.seed_program_modules(uuid) from public, anon, authenticated;
revoke all on function public.ensure_membership_for_slug(text, text) from public, anon, authenticated;
revoke all on function public.ensure_program_membership_for_slug(text, text) from public, anon, authenticated;
revoke all on function public.public_save_game_scores(uuid, jsonb) from public, anon;
grant execute on function public.request_membership_for_slug(text, text) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;

-- Organization visibility and authority only apply to active memberships.
create or replace function public.is_organization_member(p_organization_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members om
    where om.organization_id = p_organization_id and om.profile_id = auth.uid() and om.status = 'active'
  ) or public.has_platform_organization_access(p_organization_id);
$$;

create or replace function public.current_organization_id()
returns uuid language sql stable security definer set search_path = public as $$
  select om.organization_id
  from public.organization_members om
  where om.profile_id = auth.uid() and om.status = 'active'
  order by case om.role when 'owner' then 1 when 'admin' then 2 else 3 end, om.created_at
  limit 1;
$$;

create or replace function public.organization_role(p_organization_id uuid default public.current_organization_id())
returns text language sql stable security definer set search_path = public as $$
  select case
    when public.has_platform_organization_access(p_organization_id) then 'admin'
    when om.role = 'owner' then 'admin'
    else om.role
  end
  from (select 1) seed
  left join public.organization_members om
    on om.organization_id = p_organization_id and om.profile_id = auth.uid() and om.status = 'active'
  limit 1;
$$;

create or replace function public.program_role(p_program_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when public.organization_role(p.organization_id) = 'admin' then 'manager'
    else pm.role
  end
  from public.programs p
  left join public.program_members pm
    on pm.program_id = p.id and pm.profile_id = auth.uid() and pm.status = 'active'
  where p.id = p_program_id;
$$;

-- Program creation must use an enabled template.
create or replace function public.validate_enabled_program_template()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.program_template_id is null or not exists (
    select 1 from public.organization_enabled_programs enabled
    where enabled.organization_id = new.organization_id
      and enabled.program_template_id = new.program_template_id
      and enabled.enabled
  ) then raise exception 'Program template is not enabled for this organization'; end if;
  return new;
end;
$$;
drop trigger if exists validate_enabled_program_template on public.programs;
create trigger validate_enabled_program_template before insert or update
on public.programs for each row execute function public.validate_enabled_program_template();

alter table public.organization_settings add column if not exists public_balances_enabled boolean not null default false;
alter table public.organization_settings add column if not exists public_payments_enabled boolean not null default false;

create index if not exists invitations_organization_id_idx on public.invitations(organization_id);
create index if not exists invitations_program_id_idx on public.invitations(program_id);
create index if not exists organization_enabled_programs_organization_id_idx on public.organization_enabled_programs(organization_id);
