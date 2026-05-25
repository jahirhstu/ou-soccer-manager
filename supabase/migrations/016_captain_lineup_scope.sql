create or replace function public.app_player_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.current_player_id();
$$;

drop policy if exists "session_team_lineups_select" on public.session_team_lineups;
drop policy if exists "session_team_lineups_captain_write" on public.session_team_lineups;
drop policy if exists "session_team_lineups_captain_update" on public.session_team_lineups;
drop policy if exists "session_team_lineups_captain_delete" on public.session_team_lineups;

create policy "session_team_lineups_select" on public.session_team_lineups
for select using (
  public.app_role() = 'admin'
  or exists (
    select 1
    from public.session_teams st
    where st.id = session_team_lineups.session_team_id
      and st.captain_player_id = public.app_player_id()
  )
);

create policy "session_team_lineups_captain_write" on public.session_team_lineups
for insert with check (
  public.app_role() = 'captain'
  and exists (
    select 1
    from public.session_teams st
    where st.id = session_team_lineups.session_team_id
      and st.session_id = session_team_lineups.session_id
      and st.captain_player_id = public.app_player_id()
  )
);

create policy "session_team_lineups_captain_update" on public.session_team_lineups
for update using (
  public.app_role() = 'captain'
  and exists (
    select 1
    from public.session_teams st
    where st.id = session_team_lineups.session_team_id
      and st.session_id = session_team_lineups.session_id
      and st.captain_player_id = public.app_player_id()
  )
) with check (
  public.app_role() = 'captain'
  and exists (
    select 1
    from public.session_teams st
    where st.id = session_team_lineups.session_team_id
      and st.session_id = session_team_lineups.session_id
      and st.captain_player_id = public.app_player_id()
  )
);

create policy "session_team_lineups_captain_delete" on public.session_team_lineups
for delete using (
  public.app_role() = 'captain'
  and exists (
    select 1
    from public.session_teams st
    where st.id = session_team_lineups.session_team_id
      and st.session_id = session_team_lineups.session_id
      and st.captain_player_id = public.app_player_id()
  )
);
