create or replace function public.submit_session_performance_nomination(
  p_session_id uuid,p_category text,p_player_id uuid
) returns void language plpgsql security definer set search_path=public as $$
declare session public.sessions; voter_player uuid;
begin
  select * into session from public.sessions where id=p_session_id for update;
  if not coalesce(public.performance_access(session.program_id),false) then
    raise exception 'Program access required';
  end if;
  if session.status='completed' then raise exception 'Completed sessions are read-only'; end if;
  if not exists(select 1 from public.session_matches match
      where match.session_id=session.id and match.result_status='played') then
    raise exception 'Nominations open after a fixture has been marked played';
  end if;
  if exists(select 1 from public.session_performance_voting where session_id=session.id and closed) then
    raise exception 'Nominations are closed';
  end if;
  if p_category is null or p_category not in('goalkeeper','defender','midfielder') then
    raise exception 'Select Top Goalkeeper, Top Defender, or Top Midfielder';
  end if;
  select coalesce(member.player_id,organization_member.player_id) into voter_player
  from public.program_members member
  left join public.organization_members organization_member
    on organization_member.organization_id=session.organization_id
    and organization_member.profile_id=member.profile_id
    and organization_member.status='active'
  join public.players voter
    on voter.id=coalesce(member.player_id,organization_member.player_id)
    and voter.organization_id=session.organization_id
  where member.program_id=session.program_id and member.profile_id=auth.uid()
    and member.status='active';
  if voter_player is null then raise exception 'Link your account to a player profile to nominate'; end if;
  if not exists(select 1 from public.session_team_players participant
      where participant.session_id=session.id and participant.player_id=voter_player)
    and not exists(select 1 from public.session_performance_nominator_authorizations authz
      where authz.session_id=session.id and authz.player_id=voter_player) then
    raise exception 'You are not authorized to nominate for this session';
  end if;
  if p_player_id=voter_player then raise exception 'You cannot nominate yourself'; end if;
  if not exists(select 1 from public.session_team_players nominee
      join public.players player on player.id=nominee.player_id
      where nominee.session_id=session.id and nominee.player_id=p_player_id
        and player.organization_id=session.organization_id) then
    raise exception 'The nominee must have participated in this session';
  end if;
  if exists(select 1 from public.session_performance_nominations nomination
      where nomination.session_id=session.id and nomination.voter_player_id=voter_player
        and nomination.category=p_category) then
    raise exception 'You have already nominated in this category';
  end if;
  if exists(select 1 from public.session_performance_nominations nomination
      where nomination.session_id=session.id and nomination.voter_player_id=voter_player
        and nomination.player_id=p_player_id and nomination.category<>p_category) then
    raise exception 'You have already selected this player in another category';
  end if;
  insert into public.session_performance_nominations(
    session_id,voter_id,voter_player_id,category,player_id
  ) values(session.id,auth.uid(),voter_player,p_category,p_player_id)
  on conflict(session_id,voter_player_id,category) do update
    set voter_id=excluded.voter_id,player_id=excluded.player_id,created_at=now();
  insert into public.performance_changes(session_id,actor_id,action,details)
  values(session.id,auth.uid(),'player_nomination',jsonb_build_object(
    'voterPlayerId',voter_player,'category',p_category,'playerId',p_player_id
  ));
end;
$$;
