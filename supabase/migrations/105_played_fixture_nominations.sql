create or replace view public.valid_session_performance_nominations as
select nomination.session_id,nomination.voter_id,nomination.voter_player_id,
  nomination.category,nomination.player_id,nomination.created_at
from public.session_performance_nominations nomination
join public.sessions session on session.id=nomination.session_id
join public.program_members member on member.program_id=session.program_id
  and member.profile_id=nomination.voter_id and member.status='active'
left join public.organization_members organization_member
  on organization_member.organization_id=session.organization_id
  and organization_member.profile_id=nomination.voter_id
  and organization_member.status='active'
where coalesce(member.player_id,organization_member.player_id)=nomination.voter_player_id
and exists(select 1 from public.players voter
  where voter.id=nomination.voter_player_id and voter.organization_id=session.organization_id)
and (
  exists(select 1 from public.session_team_players participant
    where participant.session_id=session.id and participant.player_id=nomination.voter_player_id)
  or exists(select 1 from public.session_performance_nominator_authorizations authz
    where authz.session_id=session.id and authz.player_id=nomination.voter_player_id)
)
and exists(select 1 from public.match_performance_detail detail
  where detail.session_id=session.id and detail.player_id=nomination.player_id
    and detail.positions @> array[nomination.category]::text[])
and nomination.voter_player_id<>nomination.player_id;

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
  if not exists(select 1 from public.match_performance_detail eligible
      where eligible.session_id=session.id and eligible.player_id=p_player_id
        and eligible.positions @> array[p_category]::text[]) then
    raise exception 'The nominee must have participated at the selected position';
  end if;
  if exists(select 1 from public.session_performance_nominations nomination
      where nomination.session_id=session.id and nomination.voter_player_id=voter_player
        and nomination.category=p_category) then
    raise exception 'You have already nominated in this category';
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

create or replace function public.authorize_session_performance_nominator(
  p_session_id uuid,p_player_id uuid,p_authorized boolean
) returns void language plpgsql security definer set search_path=public as $$
declare session public.sessions;
begin
  select * into session from public.sessions where id=p_session_id for update;
  if not coalesce(public.performance_access(session.program_id)
      and public.program_role(session.program_id)='manager',false) then
    raise exception 'Manager access required';
  end if;
  if session.status='completed' then raise exception 'Completed sessions are read-only'; end if;
  if not exists(select 1 from public.session_matches match
      where match.session_id=session.id and match.result_status='played') then
    raise exception 'Nominations open after a fixture has been marked played';
  end if;
  if exists(select 1 from public.session_performance_voting where session_id=session.id and closed) then
    raise exception 'Nominations are closed';
  end if;
  if p_authorized is null then raise exception 'Authorization choice is required'; end if;
  if not exists(
      select 1
      from public.program_members member
      left join public.organization_members organization_member
        on organization_member.organization_id=session.organization_id
        and organization_member.profile_id=member.profile_id
        and organization_member.status='active'
      join public.players player
        on player.id=coalesce(member.player_id,organization_member.player_id)
        and player.organization_id=session.organization_id
      where member.program_id=session.program_id and member.status='active'
        and coalesce(member.player_id,organization_member.player_id)=p_player_id
    ) then
    raise exception 'Select an active program player';
  end if;
  if p_authorized and exists(select 1 from public.session_team_players participant
      where participant.session_id=session.id and participant.player_id=p_player_id) then
    raise exception 'Session participants are already eligible to nominate';
  end if;
  if p_authorized then
    insert into public.session_performance_nominator_authorizations(session_id,player_id,authorized_by)
    values(session.id,p_player_id,auth.uid())
    on conflict(session_id,player_id) do update
      set authorized_by=excluded.authorized_by,created_at=now();
  else
    delete from public.session_performance_nominator_authorizations
    where session_id=session.id and player_id=p_player_id;
  end if;
  insert into public.performance_changes(session_id,actor_id,action,details)
  values(session.id,auth.uid(),'nominator_authorization',jsonb_build_object(
    'playerId',p_player_id,'authorized',p_authorized
  ));
end;
$$;

create or replace function public.close_performance_voting(
  p_session_id uuid,p_closed boolean
) returns void language plpgsql security definer set search_path=public as $$
declare session public.sessions;
begin
  select * into session from public.sessions where id=p_session_id for update;
  if not coalesce(public.performance_access(session.program_id)
      and public.program_role(session.program_id)='manager',false) then
    raise exception 'Manager access required';
  end if;
  if session.status='completed' and not coalesce(p_closed,false) then
    raise exception 'Completed sessions are read-only';
  end if;
  insert into public.session_performance_voting(session_id,closed,updated_by)
  values(session.id,p_closed,auth.uid())
  on conflict(session_id) do update
    set closed=excluded.closed,updated_by=auth.uid(),updated_at=now();
  insert into public.performance_changes(session_id,actor_id,action,details)
  values(session.id,auth.uid(),'voting_status',jsonb_build_object('closed',p_closed));
end;
$$;

alter function public.session_performance(uuid)
  rename to session_performance_pre_played_nomination;
revoke all on function public.session_performance_pre_played_nomination(uuid)
  from public,anon,authenticated;

create function public.session_performance(p_session_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  session public.sessions;
  answer jsonb;
  current_voter uuid;
  can_nominate boolean;
  voters jsonb;
begin
  select * into session from public.sessions where id=p_session_id;
  answer:=public.session_performance_pre_played_nomination(p_session_id);

  select coalesce(member.player_id,organization_member.player_id) into current_voter
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

  can_nominate:=current_voter is not null
    and session.status<>'completed'
    and exists(select 1 from public.session_matches match
      where match.session_id=session.id and match.result_status='played')
    and not coalesce((select closed from public.session_performance_voting
      where session_id=session.id),false)
    and (
      exists(select 1 from public.session_team_players participant
        where participant.session_id=session.id and participant.player_id=current_voter)
      or exists(select 1 from public.session_performance_nominator_authorizations authz
        where authz.session_id=session.id and authz.player_id=current_voter)
    );

  if public.program_role(session.program_id)='manager' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'playerId',player.id,
      'name',player.display_name,
      'participated',exists(select 1 from public.session_team_players participant
        where participant.session_id=session.id and participant.player_id=player.id),
      'authorized',exists(select 1 from public.session_performance_nominator_authorizations authz
        where authz.session_id=session.id and authz.player_id=player.id)
    ) order by player.display_name,player.id),'[]'::jsonb) into voters
    from public.program_members member
    left join public.organization_members organization_member
      on organization_member.organization_id=session.organization_id
      and organization_member.profile_id=member.profile_id
      and organization_member.status='active'
    join public.players player
      on player.id=coalesce(member.player_id,organization_member.player_id)
      and player.organization_id=session.organization_id
    where member.program_id=session.program_id and member.status='active';
    answer:=jsonb_set(answer,'{voters}',voters,true);
  end if;

  answer:=jsonb_set(answer,'{voterPlayerId}',coalesce(to_jsonb(current_voter),'null'::jsonb),true);
  answer:=jsonb_set(answer,'{canNominate}',to_jsonb(can_nominate),true);
  return answer;
end;
$$;

revoke all on function public.submit_session_performance_nomination(uuid,text,uuid),
  public.authorize_session_performance_nominator(uuid,uuid,boolean),
  public.close_performance_voting(uuid,boolean),
  public.session_performance(uuid) from public,anon;
grant execute on function public.submit_session_performance_nomination(uuid,text,uuid),
  public.authorize_session_performance_nominator(uuid,uuid,boolean),
  public.close_performance_voting(uuid,boolean),
  public.session_performance(uuid) to authenticated;
