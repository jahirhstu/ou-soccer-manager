create or replace function public.lineup_builder_teams(p_session_id uuid)
returns table(
  id uuid,
  name text,
  players jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    st.id,
    st.name,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.display_name
        )
        order by p.display_name
      ) filter (where p.id is not null),
      '[]'::jsonb
    ) players
  from public.session_teams st
  join public.session_team_players current_member on current_member.session_team_id = st.id
  left join public.session_team_players stp on stp.session_team_id = st.id
  left join public.players p on p.id = stp.player_id
  where st.session_id = p_session_id
    and current_member.session_id = p_session_id
    and current_member.player_id = public.current_player_id()
    and public.is_organization_member(st.organization_id)
  group by st.id, st.name
  order by st.name;
$$;

create or replace function public.lineup_builder_lineups(p_session_id uuid)
returns table(
  session_team_id uuid,
  player_count integer,
  formation text,
  positions jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    lineups.session_team_id,
    lineups.player_count,
    lineups.formation,
    lineups.positions
  from public.session_team_lineups lineups
  join public.session_team_players current_member
    on current_member.session_team_id = lineups.session_team_id
   and current_member.session_id = lineups.session_id
  where lineups.session_id = p_session_id
    and current_member.player_id = public.current_player_id()
    and public.is_organization_member(lineups.organization_id);
$$;

grant execute on function public.lineup_builder_teams(uuid) to authenticated, service_role;
grant execute on function public.lineup_builder_lineups(uuid) to authenticated, service_role;

drop policy if exists "session_team_lineups_select" on public.session_team_lineups;
drop policy if exists "session_team_lineups_admin_all" on public.session_team_lineups;
drop policy if exists "session_team_lineups_captain_write" on public.session_team_lineups;
drop policy if exists "session_team_lineups_captain_update" on public.session_team_lineups;
drop policy if exists "session_team_lineups_captain_delete" on public.session_team_lineups;
drop policy if exists "session_team_lineups_team_member_select" on public.session_team_lineups;
drop policy if exists "session_team_lineups_team_member_insert" on public.session_team_lineups;
drop policy if exists "session_team_lineups_team_member_update" on public.session_team_lineups;
drop policy if exists "session_team_lineups_team_member_delete" on public.session_team_lineups;

create policy "session_team_lineups_team_member_select" on public.session_team_lineups
for select using (
  public.is_organization_member(organization_id)
  and exists (
    select 1
    from public.session_team_players stp
    where stp.session_id = session_team_lineups.session_id
      and stp.session_team_id = session_team_lineups.session_team_id
      and stp.player_id = public.current_player_id()
      and stp.organization_id = session_team_lineups.organization_id
  )
);

create policy "session_team_lineups_team_member_insert" on public.session_team_lineups
for insert with check (
  public.is_organization_member(organization_id)
  and exists (
    select 1
    from public.session_team_players stp
    where stp.session_id = session_team_lineups.session_id
      and stp.session_team_id = session_team_lineups.session_team_id
      and stp.player_id = public.current_player_id()
      and stp.organization_id = session_team_lineups.organization_id
  )
);

create policy "session_team_lineups_team_member_update" on public.session_team_lineups
for update using (
  public.is_organization_member(organization_id)
  and exists (
    select 1
    from public.session_team_players stp
    where stp.session_id = session_team_lineups.session_id
      and stp.session_team_id = session_team_lineups.session_team_id
      and stp.player_id = public.current_player_id()
      and stp.organization_id = session_team_lineups.organization_id
  )
) with check (
  public.is_organization_member(organization_id)
  and exists (
    select 1
    from public.session_team_players stp
    where stp.session_id = session_team_lineups.session_id
      and stp.session_team_id = session_team_lineups.session_team_id
      and stp.player_id = public.current_player_id()
      and stp.organization_id = session_team_lineups.organization_id
  )
);
