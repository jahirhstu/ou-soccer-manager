create table if not exists public.organization_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  organization_category text not null default 'sports_club' check (organization_category in ('sports_club', 'event_group', 'community_group', 'social_group', 'generic')),
  currency_code text not null default 'CAD',
  timezone text not null default 'America/Toronto',
  labels jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.organization_modules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module_key text not null,
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(organization_id, module_key)
);

create table if not exists public.programs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade default public.current_organization_id(),
  name text not null,
  slug text not null,
  category text not null default 'sport' check (category in ('sport', 'event', 'social', 'generic')),
  activity_type text not null default 'generic',
  status text not null default 'active' check (status in ('active', 'archived')),
  labels jsonb not null default '{}'::jsonb,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(organization_id, slug)
);

create table if not exists public.program_modules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade default public.current_organization_id(),
  program_id uuid not null references public.programs(id) on delete cascade,
  module_key text not null,
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(program_id, module_key)
);

create table if not exists public.program_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade default public.current_organization_id(),
  program_id uuid not null references public.programs(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  player_id uuid references public.players(id) on delete cascade,
  role text not null default 'member' check (role in ('manager', 'captain', 'member')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  check (profile_id is not null or player_id is not null)
);

create unique index if not exists program_members_program_profile_idx
  on public.program_members(program_id, profile_id)
  where profile_id is not null;

create unique index if not exists program_members_program_player_idx
  on public.program_members(program_id, player_id)
  where player_id is not null;

create index if not exists organization_modules_organization_id_idx on public.organization_modules(organization_id);
create index if not exists programs_organization_id_idx on public.programs(organization_id);
create index if not exists programs_organization_category_idx on public.programs(organization_id, category);
create index if not exists program_modules_program_id_idx on public.program_modules(program_id);
create index if not exists program_members_program_id_idx on public.program_members(program_id);
create index if not exists program_members_player_id_idx on public.program_members(player_id);

drop trigger if exists organization_settings_updated_at on public.organization_settings;
create trigger organization_settings_updated_at before update on public.organization_settings for each row execute function public.set_updated_at();
drop trigger if exists organization_modules_updated_at on public.organization_modules;
create trigger organization_modules_updated_at before update on public.organization_modules for each row execute function public.set_updated_at();
drop trigger if exists programs_updated_at on public.programs;
create trigger programs_updated_at before update on public.programs for each row execute function public.set_updated_at();
drop trigger if exists program_modules_updated_at on public.program_modules;
create trigger program_modules_updated_at before update on public.program_modules for each row execute function public.set_updated_at();
drop trigger if exists program_members_updated_at on public.program_members;
create trigger program_members_updated_at before update on public.program_members for each row execute function public.set_updated_at();

alter table public.organization_settings enable row level security;
alter table public.organization_modules enable row level security;
alter table public.programs enable row level security;
alter table public.program_modules enable row level security;
alter table public.program_members enable row level security;

drop policy if exists "organization_settings_select" on public.organization_settings;
create policy "organization_settings_select" on public.organization_settings
  for select using (public.is_organization_member(organization_id));
drop policy if exists "organization_settings_admin_all" on public.organization_settings;
create policy "organization_settings_admin_all" on public.organization_settings
  for all using (public.organization_role(organization_id) = 'admin')
  with check (public.organization_role(organization_id) = 'admin');

drop policy if exists "organization_modules_select" on public.organization_modules;
create policy "organization_modules_select" on public.organization_modules
  for select using (public.is_organization_member(organization_id));
drop policy if exists "organization_modules_admin_all" on public.organization_modules;
create policy "organization_modules_admin_all" on public.organization_modules
  for all using (public.organization_role(organization_id) = 'admin')
  with check (public.organization_role(organization_id) = 'admin');

drop policy if exists "programs_select" on public.programs;
create policy "programs_select" on public.programs
  for select using (public.is_organization_member(organization_id));
drop policy if exists "programs_admin_all" on public.programs;
create policy "programs_admin_all" on public.programs
  for all using (public.organization_role(organization_id) = 'admin')
  with check (public.organization_role(organization_id) = 'admin');

drop policy if exists "program_modules_select" on public.program_modules;
create policy "program_modules_select" on public.program_modules
  for select using (public.is_organization_member(organization_id));
drop policy if exists "program_modules_admin_all" on public.program_modules;
create policy "program_modules_admin_all" on public.program_modules
  for all using (public.organization_role(organization_id) = 'admin')
  with check (public.organization_role(organization_id) = 'admin');

drop policy if exists "program_members_select" on public.program_members;
create policy "program_members_select" on public.program_members
  for select using (public.is_organization_member(organization_id));
drop policy if exists "program_members_admin_all" on public.program_members;
create policy "program_members_admin_all" on public.program_members
  for all using (public.organization_role(organization_id) = 'admin')
  with check (public.organization_role(organization_id) = 'admin');

create or replace function public.default_program_name(p_org_name text)
returns text language sql immutable as $$
  select case
    when coalesce(p_org_name, '') ilike '%soccer%' then 'Soccer'
    when coalesce(p_org_name, '') ilike '%football%' then 'Football'
    when coalesce(p_org_name, '') ilike '%cricket%' then 'Cricket'
    when coalesce(p_org_name, '') ilike '%badminton%' then 'Badminton'
    when coalesce(p_org_name, '') ilike '%volleyball%' then 'Volleyball'
    when coalesce(p_org_name, '') ilike '%basketball%' then 'Basketball'
    else 'General'
  end;
$$;

create or replace function public.seed_program_modules(p_program_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  program_row public.programs%rowtype;
  module_keys text[];
  v_module_key text;
begin
  select * into program_row from public.programs where id = p_program_id;
  if not found then
    return;
  end if;

  if program_row.category = 'sport' then
    module_keys := array['members', 'activities', 'attendance', 'payments', 'expenses', 'teams', 'scores', 'fixtures', 'leaderboards', 'goals_assists'];
  elsif program_row.category = 'event' then
    module_keys := array['members', 'activities', 'rsvp', 'payments', 'expenses', 'budget_summary', 'tasks'];
  else
    module_keys := array['members', 'activities', 'attendance', 'payments', 'expenses'];
  end if;

  foreach v_module_key in array module_keys loop
    insert into public.program_modules(organization_id, program_id, module_key, enabled)
    values (program_row.organization_id, program_row.id, v_module_key, true)
    on conflict (program_id, module_key) do nothing;
  end loop;
end;
$$;

create or replace function public.ensure_default_program(p_organization_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  org_row public.organizations%rowtype;
  program_id uuid;
  program_name text;
begin
  select * into org_row from public.organizations where id = p_organization_id;
  if not found then
    raise exception 'Organization not found.';
  end if;

  select id into program_id
  from public.programs
  where organization_id = org_row.id
  order by created_at
  limit 1;

  if program_id is not null then
    return program_id;
  end if;

  program_name := public.default_program_name(org_row.name);

  insert into public.programs(organization_id, name, slug, category, activity_type, created_by)
  values (
    org_row.id,
    program_name,
    public.normalize_slug(program_name),
    case when program_name = 'General' then 'generic' else 'sport' end,
    case when program_name = 'General' then 'generic' else public.normalize_slug(program_name) end,
    org_row.created_by
  )
  returning id into program_id;

  perform public.seed_program_modules(program_id);
  return program_id;
end;
$$;

create or replace function public.ensure_program_membership_for_slug(p_organization_slug text, p_program_slug text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  org_id uuid;
  program_id uuid;
  v_profile_id uuid := auth.uid();
  linked_player_id uuid;
begin
  if v_profile_id is null then
    raise exception 'You must be logged in to join a program.';
  end if;

  select id into org_id
  from public.organizations
  where slug = public.normalize_slug(p_organization_slug)
  limit 1;

  if org_id is null then
    raise exception 'Organization not found for this signup URL.';
  end if;

  select id into program_id
  from public.programs
  where organization_id = org_id
    and slug = public.normalize_slug(p_program_slug)
    and status = 'active'
  limit 1;

  if program_id is null then
    raise exception 'Program not found for this signup URL.';
  end if;

  insert into public.organization_members(organization_id, profile_id, role, player_id)
  values (org_id, v_profile_id, 'player', null)
  on conflict (organization_id, profile_id) do nothing;

  select player_id into linked_player_id
  from public.organization_members om
  where om.organization_id = org_id
    and om.profile_id = v_profile_id
  limit 1;

  insert into public.program_members(organization_id, program_id, profile_id, player_id, role)
  values (org_id, program_id, v_profile_id, linked_player_id, 'member')
  on conflict do nothing;

  return program_id;
end;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  org_slug text := public.normalize_slug(new.raw_user_meta_data->>'organization_slug');
  org_id uuid;
begin
  insert into public.profiles(id, display_name, email, role)
  values(new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)), new.email, 'player')
  on conflict (id) do nothing;

  if org_slug is not null and length(org_slug) > 0 then
    select id into org_id
    from public.organizations
    where slug = org_slug
    limit 1;
  end if;

  if org_id is not null then
    insert into public.organization_members(organization_id, profile_id, role, player_id)
    values (org_id, new.id, 'player', null)
    on conflict (organization_id, profile_id) do nothing;
  else
    perform public.ensure_default_membership(new.id, 'player', null);
  end if;

  return new;
end;
$$;

insert into public.organization_settings(organization_id)
select id from public.organizations
on conflict (organization_id) do nothing;

insert into public.organization_modules(organization_id, module_key, enabled)
select org.id, module_key, true
from public.organizations org
cross join unnest(array['programs', 'members', 'activities', 'payments', 'expenses']) as module(module_key)
on conflict (organization_id, module_key) do nothing;

select public.ensure_default_program(id) from public.organizations;

alter table public.seasons add column if not exists program_id uuid references public.programs(id) on delete set null;
alter table public.sessions add column if not exists program_id uuid references public.programs(id) on delete set null;
alter table public.payments add column if not exists program_id uuid references public.programs(id) on delete set null;
alter table public.attendance add column if not exists program_id uuid references public.programs(id) on delete set null;
alter table public.dropouts add column if not exists program_id uuid references public.programs(id) on delete set null;
alter table public.ledger_entries add column if not exists program_id uuid references public.programs(id) on delete set null;
alter table public.session_player_charges add column if not exists program_id uuid references public.programs(id) on delete set null;
alter table public.session_teams add column if not exists program_id uuid references public.programs(id) on delete set null;
alter table public.session_team_players add column if not exists program_id uuid references public.programs(id) on delete set null;
alter table public.session_matches add column if not exists program_id uuid references public.programs(id) on delete set null;
alter table public.goals add column if not exists program_id uuid references public.programs(id) on delete set null;
alter table public.leagues add column if not exists program_id uuid references public.programs(id) on delete set null;
alter table public.league_teams add column if not exists program_id uuid references public.programs(id) on delete set null;
alter table public.league_team_players add column if not exists program_id uuid references public.programs(id) on delete set null;
alter table public.league_matches add column if not exists program_id uuid references public.programs(id) on delete set null;
alter table public.club_expenses add column if not exists organization_id uuid references public.organizations(id) on delete cascade default public.current_organization_id();
alter table public.club_expenses add column if not exists program_id uuid references public.programs(id) on delete set null;

update public.seasons s
set program_id = public.ensure_default_program(s.organization_id)
where s.program_id is null;

update public.sessions s
set program_id = coalesce(seasons.program_id, public.ensure_default_program(s.organization_id))
from public.seasons seasons
where s.season_id = seasons.id
  and s.program_id is null;

update public.payments p
set program_id = coalesce(
  (select sessions.program_id from public.sessions sessions where sessions.id = p.session_id),
  (select seasons.program_id from public.seasons seasons where seasons.id = p.season_id),
  public.ensure_default_program(p.organization_id)
)
where p.program_id is null;

update public.attendance a
set program_id = sessions.program_id
from public.sessions sessions
where a.session_id = sessions.id
  and a.program_id is null;

update public.dropouts d
set program_id = sessions.program_id
from public.sessions sessions
where d.session_id = sessions.id
  and d.program_id is null;

update public.ledger_entries le
set program_id = coalesce(
  (select sessions.program_id from public.sessions sessions where sessions.id = le.session_id),
  (select seasons.program_id from public.seasons seasons where seasons.id = le.season_id),
  public.ensure_default_program(le.organization_id)
)
where le.program_id is null;

update public.session_player_charges spc
set program_id = sessions.program_id
from public.sessions sessions
where spc.session_id = sessions.id
  and spc.program_id is null;

update public.session_teams st
set program_id = sessions.program_id
from public.sessions sessions
where st.session_id = sessions.id
  and st.program_id is null;

update public.session_team_players stp
set program_id = st.program_id
from public.session_teams st
where stp.session_team_id = st.id
  and stp.program_id is null;

update public.session_matches sm
set program_id = st.program_id
from public.session_teams st
where sm.team_a_id = st.id
  and sm.program_id is null;

update public.goals g
set program_id = sessions.program_id
from public.sessions sessions
where g.session_id = sessions.id
  and g.program_id is null;

update public.leagues l
set program_id = coalesce(seasons.program_id, public.ensure_default_program(l.organization_id))
from public.seasons seasons
where l.season_id = seasons.id
  and l.program_id is null;

update public.leagues l
set program_id = public.ensure_default_program(l.organization_id)
where l.season_id is null
  and l.program_id is null;

update public.league_teams lt
set program_id = l.program_id
from public.leagues l
where lt.league_id = l.id
  and lt.program_id is null;

update public.league_team_players ltp
set program_id = lt.program_id
from public.league_teams lt
where ltp.league_team_id = lt.id
  and ltp.program_id is null;

update public.league_matches lm
set program_id = l.program_id
from public.leagues l
where lm.league_id = l.id
  and lm.program_id is null;

update public.club_expenses ce
set organization_id = coalesce(
  (select sessions.organization_id from public.sessions sessions where sessions.id = ce.session_id),
  (select seasons.organization_id from public.seasons seasons where seasons.id = ce.season_id),
  public.current_organization_id()
)
where ce.organization_id is null;

update public.club_expenses ce
set organization_id = coalesce(sessions.organization_id, public.current_organization_id())
from public.sessions sessions
where ce.session_id = sessions.id
  and ce.organization_id is null;

update public.club_expenses
set organization_id = public.current_organization_id()
where organization_id is null;

alter table public.club_expenses alter column organization_id set not null;

update public.club_expenses ce
set program_id = coalesce(
  (select sessions.program_id from public.sessions sessions where sessions.id = ce.session_id),
  (select seasons.program_id from public.seasons seasons where seasons.id = ce.season_id),
  public.ensure_default_program(ce.organization_id)
)
where ce.program_id is null;

update public.club_expenses ce
set program_id = coalesce(sessions.program_id, public.ensure_default_program(ce.organization_id))
from public.sessions sessions
where ce.session_id = sessions.id
  and ce.program_id is null;

update public.club_expenses ce
set program_id = public.ensure_default_program(ce.organization_id)
where ce.program_id is null;

create index if not exists seasons_program_id_idx on public.seasons(program_id);
create index if not exists sessions_program_id_idx on public.sessions(program_id);
create index if not exists payments_program_id_idx on public.payments(program_id);
create index if not exists attendance_program_id_idx on public.attendance(program_id);
create index if not exists ledger_entries_program_id_idx on public.ledger_entries(program_id);
create index if not exists session_teams_program_id_idx on public.session_teams(program_id);
create index if not exists goals_program_id_idx on public.goals(program_id);
create index if not exists leagues_program_id_idx on public.leagues(program_id);
create index if not exists club_expenses_organization_id_idx on public.club_expenses(organization_id);
create index if not exists club_expenses_program_id_idx on public.club_expenses(program_id);

drop policy if exists "club_expenses_admin_all" on public.club_expenses;
create policy "club_expenses_admin_all" on public.club_expenses
  for all
  using (public.organization_role(organization_id) = 'admin')
  with check (public.organization_role(organization_id) = 'admin');

insert into public.program_members(organization_id, program_id, profile_id, player_id, role)
select
  om.organization_id,
  public.ensure_default_program(om.organization_id),
  om.profile_id,
  om.player_id,
  case when om.role in ('owner', 'admin') then 'manager' when om.role = 'captain' then 'captain' else 'member' end
from public.organization_members om
on conflict do nothing;

grant execute on function public.ensure_default_program(uuid) to authenticated;
grant execute on function public.seed_program_modules(uuid) to authenticated;
grant execute on function public.ensure_program_membership_for_slug(text, text) to authenticated;
