create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  public_reports_enabled boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'player' check (role in ('owner', 'admin', 'captain', 'player')),
  player_id uuid references public.players(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(organization_id, profile_id)
);

create or replace function public.normalize_slug(input text)
returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(coalesce(input, '')), '[^a-z0-9]+', '-', 'g'));
$$;

insert into public.organizations(name, slug)
values ('OU Soccer', 'ou-soccer')
on conflict (slug) do nothing;

insert into public.organization_members(organization_id, profile_id, role, player_id)
select
  org.id,
  p.id,
  case when p.role = 'admin' then 'owner' else p.role end,
  p.player_id
from public.profiles p
cross join lateral (select id from public.organizations where slug = 'ou-soccer' limit 1) org
on conflict (organization_id, profile_id) do update
set role = excluded.role,
    player_id = excluded.player_id;

create or replace function public.current_organization_id()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (
      select om.organization_id
      from public.organization_members om
      where om.profile_id = auth.uid()
      order by
        case om.role when 'owner' then 1 when 'admin' then 2 when 'captain' then 3 else 4 end,
        om.created_at
      limit 1
    ),
    (select id from public.organizations order by created_at limit 1)
  );
$$;

create or replace function public.is_organization_member(p_organization_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_organization_id
      and om.profile_id = auth.uid()
  );
$$;

create or replace function public.organization_role(p_organization_id uuid default public.current_organization_id())
returns text language sql stable security definer set search_path = public as $$
  select case
    when om.role = 'owner' then 'admin'
    else om.role
  end
  from public.organization_members om
  where om.organization_id = p_organization_id
    and om.profile_id = auth.uid()
  limit 1;
$$;

create or replace function public.app_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(public.organization_role(), (select role from public.profiles where id = auth.uid()));
$$;

create or replace function public.current_player_id()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (
      select om.player_id
      from public.organization_members om
      where om.organization_id = public.current_organization_id()
        and om.profile_id = auth.uid()
      limit 1
    ),
    (select player_id from public.profiles where id = auth.uid())
  );
$$;

create or replace function public.ensure_default_membership(p_profile_id uuid, p_role text default 'player', p_player_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  org_id uuid;
begin
  select id into org_id from public.organizations order by created_at limit 1;

  if org_id is null then
    insert into public.organizations(name, slug, created_by)
    values ('OU Soccer', 'ou-soccer', p_profile_id)
    returning id into org_id;
  end if;

  insert into public.organization_members(organization_id, profile_id, role, player_id)
  values (org_id, p_profile_id, case when p_role = 'admin' then 'owner' else p_role end, p_player_id)
  on conflict (organization_id, profile_id) do nothing;

  return org_id;
end;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, display_name, email, role)
  values(new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)), new.email, 'player')
  on conflict (id) do nothing;

  perform public.ensure_default_membership(new.id, 'player', null);
  return new;
end;
$$;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

drop policy if exists "organizations_select_member" on public.organizations;
create policy "organizations_select_member" on public.organizations
for select using (public.is_organization_member(id));

drop policy if exists "organizations_owner_all" on public.organizations;
create policy "organizations_owner_all" on public.organizations
for all using (public.organization_role(id) = 'admin') with check (public.organization_role(id) = 'admin');

drop policy if exists "organization_members_select_org" on public.organization_members;
create policy "organization_members_select_org" on public.organization_members
for select using (public.is_organization_member(organization_id));

drop policy if exists "organization_members_owner_all" on public.organization_members;
create policy "organization_members_owner_all" on public.organization_members
for all using (public.organization_role(organization_id) = 'admin') with check (public.organization_role(organization_id) = 'admin');

alter table public.organizations drop constraint if exists organizations_slug_check;
alter table public.organizations add constraint organizations_slug_check check (slug = public.normalize_slug(slug) and length(slug) > 0);

create trigger organizations_updated_at before update on public.organizations for each row execute function public.set_updated_at();
create trigger organization_members_updated_at before update on public.organization_members for each row execute function public.set_updated_at();

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select using (
  id = auth.uid()
  or exists (
    select 1
    from public.organization_members viewer
    join public.organization_members target on target.organization_id = viewer.organization_id
    where viewer.profile_id = auth.uid()
      and target.profile_id = profiles.id
      and viewer.role in ('owner', 'admin', 'captain')
  )
);

drop policy if exists "profiles_admin_all" on public.profiles;
create policy "profiles_admin_all" on public.profiles for all using (
  exists (
    select 1
    from public.organization_members viewer
    join public.organization_members target on target.organization_id = viewer.organization_id
    where viewer.profile_id = auth.uid()
      and target.profile_id = profiles.id
      and viewer.role in ('owner', 'admin')
  )
) with check (
  exists (
    select 1
    from public.organization_members viewer
    join public.organization_members target on target.organization_id = viewer.organization_id
    where viewer.profile_id = auth.uid()
      and target.profile_id = profiles.id
      and viewer.role in ('owner', 'admin')
  )
);

alter table public.players add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.player_aliases add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.playgrounds add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.seasons add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.sessions add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.payments add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.attendance add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.dropouts add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.ledger_entries add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.session_player_charges add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.session_teams add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.session_team_players add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.session_matches add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.session_team_update_events add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.goals add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.session_team_lineups add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.whatsapp_imports add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.audit_logs add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

update public.players set organization_id = (select id from public.organizations where slug = 'ou-soccer' limit 1) where organization_id is null;
update public.player_aliases pa set organization_id = p.organization_id from public.players p where pa.player_id = p.id and pa.organization_id is null;
update public.playgrounds set organization_id = (select id from public.organizations where slug = 'ou-soccer' limit 1) where organization_id is null;
update public.seasons set organization_id = (select id from public.organizations where slug = 'ou-soccer' limit 1) where organization_id is null;
update public.sessions s set organization_id = seasons.organization_id from public.seasons seasons where s.season_id = seasons.id and s.organization_id is null;
update public.payments p set organization_id = seasons.organization_id from public.seasons seasons where p.season_id = seasons.id and p.organization_id is null;
update public.attendance a set organization_id = s.organization_id from public.sessions s where a.session_id = s.id and a.organization_id is null;
update public.dropouts d set organization_id = s.organization_id from public.sessions s where d.session_id = s.id and d.organization_id is null;
update public.ledger_entries le set organization_id = seasons.organization_id from public.seasons seasons where le.season_id = seasons.id and le.organization_id is null;
update public.session_player_charges spc set organization_id = s.organization_id from public.sessions s where spc.session_id = s.id and spc.organization_id is null;
update public.session_teams st set organization_id = s.organization_id from public.sessions s where st.session_id = s.id and st.organization_id is null;
update public.session_team_players stp set organization_id = st.organization_id from public.session_teams st where stp.session_team_id = st.id and stp.organization_id is null;
update public.session_matches sm set organization_id = st.organization_id from public.session_teams st where sm.team_a_id = st.id and sm.organization_id is null;
update public.session_team_update_events e set organization_id = s.organization_id from public.sessions s where e.session_id = s.id and e.organization_id is null;
update public.goals g set organization_id = s.organization_id from public.sessions s where g.session_id = s.id and g.organization_id is null;
update public.session_team_lineups l set organization_id = st.organization_id from public.session_teams st where l.session_team_id = st.id and l.organization_id is null;
update public.whatsapp_imports wi set organization_id = s.organization_id from public.sessions s where wi.session_id = s.id and wi.organization_id is null;
update public.whatsapp_imports wi set organization_id = seasons.organization_id from public.seasons seasons where wi.season_id = seasons.id and wi.organization_id is null;
update public.whatsapp_imports set organization_id = (select id from public.organizations where slug = 'ou-soccer' limit 1) where organization_id is null;
update public.audit_logs set organization_id = (select id from public.organizations where slug = 'ou-soccer' limit 1) where organization_id is null;

alter table public.players alter column organization_id set default public.current_organization_id();
alter table public.player_aliases alter column organization_id set default public.current_organization_id();
alter table public.playgrounds alter column organization_id set default public.current_organization_id();
alter table public.seasons alter column organization_id set default public.current_organization_id();
alter table public.sessions alter column organization_id set default public.current_organization_id();
alter table public.payments alter column organization_id set default public.current_organization_id();
alter table public.attendance alter column organization_id set default public.current_organization_id();
alter table public.dropouts alter column organization_id set default public.current_organization_id();
alter table public.ledger_entries alter column organization_id set default public.current_organization_id();
alter table public.session_player_charges alter column organization_id set default public.current_organization_id();
alter table public.session_teams alter column organization_id set default public.current_organization_id();
alter table public.session_team_players alter column organization_id set default public.current_organization_id();
alter table public.session_matches alter column organization_id set default public.current_organization_id();
alter table public.session_team_update_events alter column organization_id set default public.current_organization_id();
alter table public.goals alter column organization_id set default public.current_organization_id();
alter table public.session_team_lineups alter column organization_id set default public.current_organization_id();
alter table public.whatsapp_imports alter column organization_id set default public.current_organization_id();
alter table public.audit_logs alter column organization_id set default public.current_organization_id();

alter table public.players alter column organization_id set not null;
alter table public.player_aliases alter column organization_id set not null;
alter table public.playgrounds alter column organization_id set not null;
alter table public.seasons alter column organization_id set not null;
alter table public.sessions alter column organization_id set not null;
alter table public.payments alter column organization_id set not null;
alter table public.attendance alter column organization_id set not null;
alter table public.dropouts alter column organization_id set not null;
alter table public.ledger_entries alter column organization_id set not null;
alter table public.session_player_charges alter column organization_id set not null;
alter table public.session_teams alter column organization_id set not null;
alter table public.session_team_players alter column organization_id set not null;
alter table public.session_matches alter column organization_id set not null;
alter table public.session_team_update_events alter column organization_id set not null;
alter table public.goals alter column organization_id set not null;
alter table public.session_team_lineups alter column organization_id set not null;
alter table public.whatsapp_imports alter column organization_id set not null;
alter table public.audit_logs alter column organization_id set not null;

drop index if exists player_aliases_normalized_alias_idx;
alter table public.player_aliases drop constraint if exists player_aliases_normalized_alias_key;
create unique index if not exists player_aliases_org_normalized_alias_idx on public.player_aliases(organization_id, normalized_alias);

alter table public.playgrounds drop constraint if exists playgrounds_name_key;
create unique index if not exists playgrounds_org_name_idx on public.playgrounds(organization_id, lower(name));

create index if not exists players_organization_id_idx on public.players(organization_id);
create index if not exists seasons_organization_id_idx on public.seasons(organization_id);
create index if not exists sessions_organization_id_idx on public.sessions(organization_id);
create index if not exists payments_organization_id_idx on public.payments(organization_id);
create index if not exists attendance_organization_id_idx on public.attendance(organization_id);
create index if not exists session_teams_organization_id_idx on public.session_teams(organization_id);
create index if not exists session_matches_organization_id_idx on public.session_matches(organization_id);
create index if not exists goals_organization_id_idx on public.goals(organization_id);

drop policy if exists "players_select" on public.players;
create policy "players_select" on public.players for select using (public.is_organization_member(organization_id) and (public.app_role() in ('admin','captain') or id = public.current_player_id()));
drop policy if exists "players_admin_all" on public.players;
create policy "players_admin_all" on public.players for all using (public.organization_role(organization_id) = 'admin') with check (public.organization_role(organization_id) = 'admin');

drop policy if exists "playgrounds_select" on public.playgrounds;
create policy "playgrounds_select" on public.playgrounds for select using (public.is_organization_member(organization_id));
drop policy if exists "playgrounds_admin_all" on public.playgrounds;
create policy "playgrounds_admin_all" on public.playgrounds for all using (public.organization_role(organization_id) = 'admin') with check (public.organization_role(organization_id) = 'admin');

drop policy if exists "seasons_select" on public.seasons;
create policy "seasons_select" on public.seasons for select using (public.is_organization_member(organization_id));
drop policy if exists "seasons_admin_all" on public.seasons;
create policy "seasons_admin_all" on public.seasons for all using (public.organization_role(organization_id) = 'admin') with check (public.organization_role(organization_id) = 'admin');

drop policy if exists "sessions_select" on public.sessions;
create policy "sessions_select" on public.sessions for select using (public.is_organization_member(organization_id));
drop policy if exists "sessions_admin_all" on public.sessions;
create policy "sessions_admin_all" on public.sessions for all using (public.organization_role(organization_id) = 'admin') with check (public.organization_role(organization_id) = 'admin');

drop policy if exists "payments_select" on public.payments;
create policy "payments_select" on public.payments for select using (public.is_organization_member(organization_id) and (public.app_role() in ('admin','captain') or player_id = public.current_player_id()));
drop policy if exists "payments_admin_all" on public.payments;
create policy "payments_admin_all" on public.payments for all using (public.organization_role(organization_id) = 'admin') with check (public.organization_role(organization_id) = 'admin');

drop policy if exists "player_aliases_select" on public.player_aliases;
create policy "player_aliases_select" on public.player_aliases for select using (public.is_organization_member(organization_id));
drop policy if exists "player_aliases_admin_all" on public.player_aliases;
create policy "player_aliases_admin_all" on public.player_aliases for all using (public.organization_role(organization_id) = 'admin') with check (public.organization_role(organization_id) = 'admin');

drop policy if exists "attendance_select" on public.attendance;
create policy "attendance_select" on public.attendance for select using (public.is_organization_member(organization_id) and (public.app_role() in ('admin','captain') or player_id = public.current_player_id()));
drop policy if exists "attendance_admin_all" on public.attendance;
create policy "attendance_admin_all" on public.attendance for all using (public.organization_role(organization_id) = 'admin') with check (public.organization_role(organization_id) = 'admin');
drop policy if exists "attendance_captain_write" on public.attendance;
create policy "attendance_captain_write" on public.attendance for insert with check (public.organization_role(organization_id) = 'captain');
drop policy if exists "attendance_captain_update" on public.attendance;
create policy "attendance_captain_update" on public.attendance for update using (public.organization_role(organization_id) = 'captain') with check (public.organization_role(organization_id) = 'captain');

drop policy if exists "session_teams_select" on public.session_teams;
create policy "session_teams_select" on public.session_teams for select using (public.is_organization_member(organization_id));
drop policy if exists "session_teams_admin_all" on public.session_teams;
create policy "session_teams_admin_all" on public.session_teams for all using (public.organization_role(organization_id) = 'admin') with check (public.organization_role(organization_id) = 'admin');
drop policy if exists "session_teams_captain_write" on public.session_teams;
create policy "session_teams_captain_write" on public.session_teams for insert with check (public.organization_role(organization_id) = 'captain');
drop policy if exists "session_teams_captain_update" on public.session_teams;
create policy "session_teams_captain_update" on public.session_teams for update using (public.organization_role(organization_id) = 'captain') with check (public.organization_role(organization_id) = 'captain');

drop policy if exists "session_team_players_select" on public.session_team_players;
create policy "session_team_players_select" on public.session_team_players for select using (public.is_organization_member(organization_id));
drop policy if exists "session_team_players_admin_all" on public.session_team_players;
create policy "session_team_players_admin_all" on public.session_team_players for all using (public.organization_role(organization_id) = 'admin') with check (public.organization_role(organization_id) = 'admin');
drop policy if exists "session_team_players_captain_write" on public.session_team_players;
create policy "session_team_players_captain_write" on public.session_team_players for insert with check (public.organization_role(organization_id) = 'captain');
drop policy if exists "session_team_players_captain_update" on public.session_team_players;
create policy "session_team_players_captain_update" on public.session_team_players for update using (public.organization_role(organization_id) = 'captain') with check (public.organization_role(organization_id) = 'captain');

drop policy if exists "session_matches_select" on public.session_matches;
create policy "session_matches_select" on public.session_matches for select using (public.is_organization_member(organization_id));
drop policy if exists "session_matches_admin_all" on public.session_matches;
create policy "session_matches_admin_all" on public.session_matches for all using (public.organization_role(organization_id) = 'admin') with check (public.organization_role(organization_id) = 'admin');
drop policy if exists "session_matches_captain_write" on public.session_matches;
create policy "session_matches_captain_write" on public.session_matches for insert with check (public.organization_role(organization_id) = 'captain');
drop policy if exists "session_matches_captain_update" on public.session_matches;
create policy "session_matches_captain_update" on public.session_matches for update using (public.organization_role(organization_id) = 'captain') with check (public.organization_role(organization_id) = 'captain');
drop policy if exists "session_matches_captain_delete" on public.session_matches;
create policy "session_matches_captain_delete" on public.session_matches for delete using (public.organization_role(organization_id) = 'captain');

drop policy if exists "dropouts_select" on public.dropouts;
create policy "dropouts_select" on public.dropouts for select using (public.is_organization_member(organization_id) and (public.app_role() in ('admin','captain') or original_player_id = public.current_player_id() or replacement_player_id = public.current_player_id()));
drop policy if exists "dropouts_admin_all" on public.dropouts;
create policy "dropouts_admin_all" on public.dropouts for all using (public.organization_role(organization_id) = 'admin') with check (public.organization_role(organization_id) = 'admin');

drop policy if exists "ledger_select" on public.ledger_entries;
create policy "ledger_select" on public.ledger_entries for select using (public.is_organization_member(organization_id) and (public.app_role() in ('admin','captain') or player_id = public.current_player_id()));
drop policy if exists "ledger_admin_all" on public.ledger_entries;
create policy "ledger_admin_all" on public.ledger_entries for all using (public.organization_role(organization_id) = 'admin') with check (public.organization_role(organization_id) = 'admin');

drop policy if exists "session_charges_select" on public.session_player_charges;
create policy "session_charges_select" on public.session_player_charges for select using (public.is_organization_member(organization_id) and (public.app_role() in ('admin','captain') or player_id = public.current_player_id()));
drop policy if exists "session_charges_admin_all" on public.session_player_charges;
create policy "session_charges_admin_all" on public.session_player_charges for all using (public.organization_role(organization_id) = 'admin') with check (public.organization_role(organization_id) = 'admin');

drop policy if exists "session_team_update_events_public_select" on public.session_team_update_events;
create policy "session_team_update_events_public_select" on public.session_team_update_events for select using (true);

drop policy if exists "session_team_lineups_select" on public.session_team_lineups;
create policy "session_team_lineups_select" on public.session_team_lineups for select using (public.is_organization_member(organization_id));
drop policy if exists "session_team_lineups_admin_all" on public.session_team_lineups;
create policy "session_team_lineups_admin_all" on public.session_team_lineups for all using (public.organization_role(organization_id) = 'admin') with check (public.organization_role(organization_id) = 'admin');
drop policy if exists "session_team_lineups_captain_write" on public.session_team_lineups;
create policy "session_team_lineups_captain_write" on public.session_team_lineups for insert with check (
  public.organization_role(organization_id) = 'captain'
  and exists (
    select 1 from public.session_teams st
    where st.id = session_team_id
      and st.captain_player_id = public.current_player_id()
  )
);
drop policy if exists "session_team_lineups_captain_update" on public.session_team_lineups;
create policy "session_team_lineups_captain_update" on public.session_team_lineups for update using (
  public.organization_role(organization_id) = 'captain'
  and exists (
    select 1 from public.session_teams st
    where st.id = session_team_id
      and st.captain_player_id = public.current_player_id()
  )
) with check (
  public.organization_role(organization_id) = 'captain'
  and exists (
    select 1 from public.session_teams st
    where st.id = session_team_id
      and st.captain_player_id = public.current_player_id()
  )
);
drop policy if exists "session_team_lineups_captain_delete" on public.session_team_lineups;
create policy "session_team_lineups_captain_delete" on public.session_team_lineups for delete using (
  public.organization_role(organization_id) = 'captain'
  and exists (
    select 1 from public.session_teams st
    where st.id = session_team_id
      and st.captain_player_id = public.current_player_id()
  )
);

drop policy if exists "goals_select" on public.goals;
create policy "goals_select" on public.goals for select using (public.is_organization_member(organization_id) and (public.app_role() in ('admin','captain') or scorer_id = public.current_player_id() or assist_player_id = public.current_player_id()));
drop policy if exists "goals_admin_all" on public.goals;
create policy "goals_admin_all" on public.goals for all using (public.organization_role(organization_id) = 'admin') with check (public.organization_role(organization_id) = 'admin');
drop policy if exists "goals_captain_write" on public.goals;
create policy "goals_captain_write" on public.goals for insert with check (public.organization_role(organization_id) = 'captain');
drop policy if exists "goals_captain_update" on public.goals;
create policy "goals_captain_update" on public.goals for update using (public.organization_role(organization_id) = 'captain') with check (public.organization_role(organization_id) = 'captain');
drop policy if exists "goals_captain_delete" on public.goals;
create policy "goals_captain_delete" on public.goals for delete using (public.organization_role(organization_id) = 'captain');

drop policy if exists "imports_admin_all" on public.whatsapp_imports;
create policy "imports_admin_all" on public.whatsapp_imports for all using (public.organization_role(organization_id) = 'admin') with check (public.organization_role(organization_id) = 'admin');

drop policy if exists "audit_admin_select" on public.audit_logs;
create policy "audit_admin_select" on public.audit_logs for select using (public.organization_role(organization_id) = 'admin');
drop policy if exists "audit_admin_insert" on public.audit_logs;
create policy "audit_admin_insert" on public.audit_logs for insert with check (public.organization_role(organization_id) = 'admin');
