create or replace function public.is_program_module_enabled(p_program_id uuid, p_module_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select p.status = 'active' and coalesce((
    select module.enabled from public.program_modules module
    where module.program_id = p.id and module.module_key = p_module_key
  ), true)
  from public.programs p where p.id = p_program_id;
$$;

-- Compatibility for legacy definer implementations that call organization_role internally.
-- Only authorized wrappers set this transaction-local program id.
create or replace function public.organization_role(p_organization_id uuid default public.current_organization_id())
returns text language sql stable security definer set search_path = public as $$
  select case
    when public.has_platform_organization_access(p_organization_id) then 'admin'
    when nullif(current_setting('app.authorized_program_id', true), '') is not null and exists (
      select 1 from public.programs p
      join public.program_members pm on pm.program_id = p.id
      where p.id = current_setting('app.authorized_program_id', true)::uuid
        and p.organization_id = p_organization_id
        and pm.profile_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('manager', 'captain')
    ) then case when exists (
      select 1 from public.program_members pm
      where pm.program_id = current_setting('app.authorized_program_id', true)::uuid
        and pm.profile_id = auth.uid() and pm.status = 'active' and pm.role = 'manager'
    ) then 'admin' else 'captain' end
    when om.role = 'owner' then 'admin'
    else om.role
  end
  from (select 1) seed
  left join public.organization_members om
    on om.organization_id = p_organization_id and om.profile_id = auth.uid() and om.status = 'active'
  limit 1;
$$;

create or replace function public.save_program_game_scores(p_session_id uuid, p_games jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_program_id uuid;
begin
  select program_id into v_program_id from public.sessions where id = p_session_id;
  if auth.uid() is null or public.program_role(v_program_id) not in ('manager', 'captain') then
    raise exception 'Unauthorized';
  end if;
  if not public.is_program_module_enabled(v_program_id, 'scores') then
    raise exception 'Scores are disabled for this program';
  end if;
  return public.public_save_game_scores(p_session_id, p_games);
end;
$$;

create or replace function public.save_program_team_builder(p_session_id uuid, p_teams jsonb, p_players_per_team integer default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_program_id uuid;
begin
  select program_id into v_program_id from public.sessions where id = p_session_id;
  if auth.uid() is null or public.program_role(v_program_id) not in ('manager', 'captain') then
    raise exception 'Unauthorized';
  end if;
  if not public.is_program_module_enabled(v_program_id, 'teams') then
    raise exception 'Team builder is disabled for this program';
  end if;
  perform set_config('app.authorized_program_id', v_program_id::text, true);
  perform public.save_session_team_builder(p_session_id, p_teams, p_players_per_team);
end;
$$;

create or replace function public.save_program_team_builder_draft(
  p_session_id uuid, p_teams jsonb, p_players_per_team integer, p_draft_mode text,
  p_pick_cursor integer, p_toss_order_keys jsonb default null, p_roulette_rotation numeric default 0
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_program_id uuid;
begin
  select program_id into v_program_id from public.sessions where id = p_session_id;
  if auth.uid() is null or public.program_role(v_program_id) not in ('manager', 'captain') then
    raise exception 'Unauthorized';
  end if;
  if not public.is_program_module_enabled(v_program_id, 'teams') then
    raise exception 'Team builder is disabled for this program';
  end if;
  perform set_config('app.authorized_program_id', v_program_id::text, true);
  return public.save_session_team_builder_draft(
    p_session_id, p_teams, p_players_per_team, p_draft_mode, p_pick_cursor,
    p_toss_order_keys, p_roulette_rotation
  );
end;
$$;

create or replace function public.link_current_program_player_profile(p_program_id uuid, p_player_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_organization_id uuid;
begin
  select organization_id into v_organization_id from public.programs where id = p_program_id;
  if auth.uid() is null or public.program_role(p_program_id) <> 'captain' then raise exception 'Unauthorized'; end if;
  if not exists (select 1 from public.players where id = p_player_id and organization_id = v_organization_id) then
    raise exception 'Player not found in this organization';
  end if;
  update public.organization_members set player_id = p_player_id
  where organization_id = v_organization_id and profile_id = auth.uid() and status = 'active';
  update public.program_members set player_id = p_player_id
  where program_id = p_program_id and profile_id = auth.uid() and status = 'active';
  update public.profiles set player_id = p_player_id where id = auth.uid();
end;
$$;

revoke all on function public.public_save_game_scores(uuid, jsonb) from authenticated;
revoke all on function public.save_session_team_builder(uuid, jsonb, integer) from public, anon, authenticated;
revoke all on function public.save_session_team_builder_draft(uuid, jsonb, integer, text, integer, jsonb, numeric) from public, anon, authenticated;
revoke all on function public.link_current_captain_player_profile(uuid) from public, anon, authenticated;
grant execute on function public.save_program_game_scores(uuid, jsonb) to authenticated;
grant execute on function public.save_program_team_builder(uuid, jsonb, integer) to authenticated;
grant execute on function public.save_program_team_builder_draft(uuid, jsonb, integer, text, integer, jsonb, numeric) to authenticated;
grant execute on function public.is_program_module_enabled(uuid, text) to authenticated;
grant execute on function public.link_current_program_player_profile(uuid, uuid) to authenticated;

drop policy if exists "attendance_captain_write" on public.attendance;
drop policy if exists "attendance_captain_update" on public.attendance;
create policy "attendance_program_captain_insert" on public.attendance for insert
  with check (public.program_role(program_id) in ('manager', 'captain') and public.is_program_module_enabled(program_id, 'attendance'));
create policy "attendance_program_captain_update" on public.attendance for update
  using (public.program_role(program_id) in ('manager', 'captain'))
  with check (public.program_role(program_id) in ('manager', 'captain') and public.is_program_module_enabled(program_id, 'attendance'));

drop policy if exists "session_teams_captain_write" on public.session_teams;
drop policy if exists "session_teams_captain_update" on public.session_teams;
create policy "session_teams_program_captain_insert" on public.session_teams for insert
  with check (public.program_role(program_id) in ('manager', 'captain') and public.is_program_module_enabled(program_id, 'teams'));
create policy "session_teams_program_captain_update" on public.session_teams for update
  using (public.program_role(program_id) in ('manager', 'captain'))
  with check (public.program_role(program_id) in ('manager', 'captain') and public.is_program_module_enabled(program_id, 'teams'));

drop policy if exists "session_team_players_captain_write" on public.session_team_players;
drop policy if exists "session_team_players_captain_update" on public.session_team_players;
create policy "session_team_players_program_captain_insert" on public.session_team_players for insert
  with check (public.program_role(program_id) in ('manager', 'captain') and public.is_program_module_enabled(program_id, 'teams'));
create policy "session_team_players_program_captain_update" on public.session_team_players for update
  using (public.program_role(program_id) in ('manager', 'captain'))
  with check (public.program_role(program_id) in ('manager', 'captain') and public.is_program_module_enabled(program_id, 'teams'));

drop policy if exists "session_matches_captain_write" on public.session_matches;
drop policy if exists "session_matches_captain_update" on public.session_matches;
drop policy if exists "session_matches_captain_delete" on public.session_matches;
create policy "session_matches_program_captain_insert" on public.session_matches for insert
  with check (public.program_role(program_id) in ('manager', 'captain') and public.is_program_module_enabled(program_id, 'scores'));
create policy "session_matches_program_captain_update" on public.session_matches for update
  using (public.program_role(program_id) in ('manager', 'captain'))
  with check (public.program_role(program_id) in ('manager', 'captain') and public.is_program_module_enabled(program_id, 'scores'));
create policy "session_matches_program_captain_delete" on public.session_matches for delete
  using (public.program_role(program_id) in ('manager', 'captain') and public.is_program_module_enabled(program_id, 'scores'));

drop policy if exists "goals_captain_write" on public.goals;
drop policy if exists "goals_captain_update" on public.goals;
drop policy if exists "goals_captain_delete" on public.goals;
create policy "goals_program_captain_insert" on public.goals for insert
  with check (public.program_role(program_id) in ('manager', 'captain') and public.is_program_module_enabled(program_id, 'goals_assists'));
create policy "goals_program_captain_update" on public.goals for update
  using (public.program_role(program_id) in ('manager', 'captain'))
  with check (public.program_role(program_id) in ('manager', 'captain') and public.is_program_module_enabled(program_id, 'goals_assists'));
create policy "goals_program_captain_delete" on public.goals for delete
  using (public.program_role(program_id) in ('manager', 'captain') and public.is_program_module_enabled(program_id, 'goals_assists'));

drop policy if exists "player_performance_ratings_captain_insert" on public.player_performance_ratings;
drop policy if exists "player_performance_ratings_captain_update" on public.player_performance_ratings;
drop policy if exists "player_performance_ratings_captain_delete" on public.player_performance_ratings;
create policy "performance_program_captain_insert" on public.player_performance_ratings for insert
  with check (public.program_role(program_id) in ('manager', 'captain'));
create policy "performance_program_captain_update" on public.player_performance_ratings for update
  using (public.program_role(program_id) in ('manager', 'captain'))
  with check (public.program_role(program_id) in ('manager', 'captain'));
create policy "performance_program_captain_delete" on public.player_performance_ratings for delete
  using (public.program_role(program_id) in ('manager', 'captain'));

drop policy if exists "session_team_builder_drafts_captain_write" on public.session_team_builder_drafts;
drop policy if exists "session_team_builder_drafts_captain_update" on public.session_team_builder_drafts;
drop policy if exists "session_team_builder_drafts_captain_delete" on public.session_team_builder_drafts;
create policy "team_builder_drafts_program_captain_insert" on public.session_team_builder_drafts for insert
  with check (exists (
    select 1 from public.sessions s where s.id = session_id
      and public.program_role(s.program_id) in ('manager', 'captain')
      and public.is_program_module_enabled(s.program_id, 'teams')
  ));
create policy "team_builder_drafts_program_captain_update" on public.session_team_builder_drafts for update
  using (exists (select 1 from public.sessions s where s.id = session_id and public.program_role(s.program_id) in ('manager', 'captain')))
  with check (exists (select 1 from public.sessions s where s.id = session_id and public.program_role(s.program_id) in ('manager', 'captain') and public.is_program_module_enabled(s.program_id, 'teams')));
create policy "team_builder_drafts_program_captain_delete" on public.session_team_builder_drafts for delete
  using (exists (select 1 from public.sessions s where s.id = session_id and public.program_role(s.program_id) in ('manager', 'captain')));

drop policy if exists "session_team_lineups_captain_write" on public.session_team_lineups;
drop policy if exists "session_team_lineups_captain_update" on public.session_team_lineups;
drop policy if exists "session_team_lineups_captain_delete" on public.session_team_lineups;
create policy "lineups_program_captain_insert" on public.session_team_lineups for insert
  with check (exists (
    select 1 from public.session_teams team where team.id = session_team_id
      and public.program_role(team.program_id) in ('manager', 'captain')
      and public.is_program_module_enabled(team.program_id, 'teams')
  ));
create policy "lineups_program_captain_update" on public.session_team_lineups for update
  using (exists (select 1 from public.session_teams team where team.id = session_team_id and public.program_role(team.program_id) in ('manager', 'captain')))
  with check (exists (select 1 from public.session_teams team where team.id = session_team_id and public.program_role(team.program_id) in ('manager', 'captain') and public.is_program_module_enabled(team.program_id, 'teams')));
create policy "lineups_program_captain_delete" on public.session_team_lineups for delete
  using (exists (select 1 from public.session_teams team where team.id = session_team_id and public.program_role(team.program_id) in ('manager', 'captain')));

create policy "program_members_manager_all" on public.program_members for all
  using (public.program_role(program_id) = 'manager')
  with check (public.program_role(program_id) = 'manager');

create policy "players_program_manager_insert" on public.players for insert
  with check (exists (
    select 1 from public.programs p where p.organization_id = players.organization_id and public.program_role(p.id) = 'manager'
  ));
create policy "players_program_staff_select" on public.players for select
  using (exists (
    select 1 from public.program_members pm
    where pm.player_id = players.id and public.program_role(pm.program_id) in ('manager', 'captain')
  ));
create policy "players_program_manager_update" on public.players for update
  using (exists (
    select 1 from public.program_members pm where pm.player_id = players.id and public.program_role(pm.program_id) = 'manager'
  ))
  with check (exists (
    select 1 from public.program_members pm where pm.player_id = players.id and public.program_role(pm.program_id) = 'manager'
  ));

-- RLS policies are permissive by default; a trigger also blocks direct API writes when a module is disabled.
create or replace function public.prevent_disabled_program_writes()
returns trigger language plpgsql set search_path = public as $$
declare v_program_id uuid;
begin
  if tg_op = 'DELETE' then v_program_id := old.program_id; else v_program_id := new.program_id; end if;
  if v_program_id is null or not public.is_program_module_enabled(v_program_id, tg_argv[0]) then
    raise exception '% is disabled for this program', replace(tg_argv[0], '_', ' ');
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

do $$
declare item text[];
begin
  foreach item slice 1 in array array[
    array['seasons','activities'], array['sessions','activities'],
    array['payments','payments'], array['ledger_entries','payments'], array['session_player_charges','payments'],
    array['club_expenses','expenses'], array['attendance','attendance'], array['dropouts','attendance'],
    array['session_teams','teams'], array['session_team_players','teams'],
    array['session_matches','scores'], array['goals','goals_assists'],
    array['leagues','leagues'], array['league_teams','leagues'], array['league_team_players','leagues'], array['league_matches','leagues'],
    array['player_performance_ratings','teams']
  ] loop
    if to_regclass('public.' || item[1]) is not null then
      execute format('drop trigger if exists prevent_disabled_program_writes on public.%I', item[1]);
      execute format('create trigger prevent_disabled_program_writes before insert or update or delete on public.%I for each row execute function public.prevent_disabled_program_writes(%L)', item[1], item[2]);
    end if;
  end loop;
end $$;
