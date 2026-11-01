create table public.session_performance_nominator_authorizations (
  session_id uuid not null references public.sessions(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  authorized_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key(session_id,player_id)
);

create table public.session_performance_nominations (
  session_id uuid not null references public.sessions(id) on delete cascade,
  voter_id uuid not null references public.profiles(id),
  voter_player_id uuid not null references public.players(id),
  category text not null check(category in ('goalkeeper','defender','midfielder')),
  player_id uuid not null references public.players(id),
  created_at timestamptz not null default now(),
  primary key(session_id,voter_player_id,category),
  check(voter_player_id<>player_id)
);
create index session_performance_nominations_category_player_idx
  on public.session_performance_nominations(session_id,category,player_id);

alter table public.session_performance_nominator_authorizations enable row level security;
alter table public.session_performance_nominations enable row level security;
revoke all on public.session_performance_nominator_authorizations,public.session_performance_nominations from public,anon,authenticated;

create view public.valid_session_performance_nominations as
select nomination.session_id,nomination.voter_id,nomination.voter_player_id,
  nomination.category,nomination.player_id,nomination.created_at
from public.session_performance_nominations nomination
join public.sessions session on session.id=nomination.session_id and session.status='completed'
join public.program_members member on member.program_id=session.program_id
  and member.profile_id=nomination.voter_id and member.player_id=nomination.voter_player_id
  and member.status='active'
where (
  exists(select 1 from public.session_team_players participant
    where participant.session_id=session.id and participant.player_id=nomination.voter_player_id)
  or exists(select 1 from public.session_performance_nominator_authorizations authz
    where authz.session_id=session.id and authz.player_id=nomination.voter_player_id)
)
and exists(select 1 from public.match_performance_detail eligible
  where eligible.session_id=session.id and eligible.player_id=nomination.player_id
    and eligible.position=nomination.category)
and nomination.voter_player_id<>nomination.player_id;

create or replace view public.valid_performance_votes as
select legacy.session_id,legacy.captain_team_id,legacy.category,legacy.player_id,legacy.voter_id,legacy.updated_at
from public.captain_performance_votes legacy
join public.sessions session on session.id=legacy.session_id and session.status='completed'
join public.session_teams captain on captain.id=legacy.captain_team_id and captain.session_id=session.id
where exists(select 1 from public.program_members member where member.program_id=session.program_id
  and member.profile_id=legacy.voter_id and member.status='active' and member.player_id=captain.captain_player_id)
and exists(select 1 from public.match_performance_detail detail
  where detail.session_id=session.id and detail.player_id=legacy.player_id and detail.position=legacy.category)
and not exists(select 1 from public.session_team_players own
  where own.session_id=session.id and own.session_team_id=captain.id and own.player_id=legacy.player_id)
and not exists(select 1 from public.valid_session_performance_nominations nomination
  where nomination.session_id=legacy.session_id and nomination.voter_id=legacy.voter_id
    and nomination.category=legacy.category)
union all
select nomination.session_id,null::uuid,nomination.category,nomination.player_id,
  nomination.voter_id,nomination.created_at
from public.valid_session_performance_nominations nomination;

create view public.session_category_nomination_points as
with vote_counts as (
  select session_id,category,count(*)::numeric total_votes
  from public.valid_performance_votes
  group by session_id,category
), received as (
  select session_id,category,player_id,count(*)::numeric votes_received
  from public.valid_performance_votes
  group by session_id,category,player_id
)
select received.session_id,received.category,received.player_id,
  received.votes_received,
  least(20::numeric,60::numeric/vote_counts.total_votes) points_per_vote,
  least(60::numeric,received.votes_received*least(20::numeric,60::numeric/vote_counts.total_votes)) nomination_points
from received join vote_counts using(session_id,category);

create view public.session_player_nomination_points as
select session_id,player_id,least(60::numeric,sum(nomination_points)) nomination_points
from public.session_category_nomination_points
group by session_id,player_id;

create or replace view public.session_performance_results as
select detail.session_id,detail.season_id,detail.program_id,detail.player_id,detail.player_name,
  count(*)::integer matches_played,
  count(*) filter(where detail.position is not null)::integer rated_matches,
  array_agg(distinct detail.position) filter(where detail.position is not null) positions,
  round(sum(coalesce((detail.breakdown->>'rating')::numeric,0))*4/count(*),2) match_points,
  round(coalesce(nomination.nomination_points,0))::integer captain_points,
  round(sum(coalesce((detail.breakdown->>'rating')::numeric,0))*4/count(*)
    +coalesce(nomination.nomination_points,0),2) final_rating,
  sum(detail.goals)::integer goals,sum(detail.assists)::integer assists,
  count(*) filter(where detail.clean_sheet)::integer clean_sheets,
  sum(detail.keeper_conceded)::integer keeper_conceded,
  bool_or(detail.position is null or detail.keeper_attribution_incomplete) incomplete,
  coalesce(nomination.nomination_points,0)::numeric nomination_points
from public.match_performance_detail detail
left join public.session_player_nomination_points nomination
  on nomination.session_id=detail.session_id and nomination.player_id=detail.player_id
group by detail.session_id,detail.season_id,detail.program_id,detail.player_id,detail.player_name,
  nomination.nomination_points;

create or replace function public.performance_season_rows(p_season_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce((select jsonb_agg(to_jsonb(r) order by position,average_session_rating desc,player_name) from (
    select detail.player_id,detail.player_name,detail.position,count(*) matches_played,
      count(distinct detail.session_id) sessions_played,
      round(avg((detail.breakdown->>'rating')::numeric),2) average_match_rating,
      (select round(avg(session_rating.points),2) from (
        select avg((match_detail.breakdown->>'rating')::numeric)*4
          +coalesce(category_points.nomination_points,0) points
        from public.match_performance_detail match_detail
        left join public.session_category_nomination_points category_points
          on category_points.session_id=match_detail.session_id
          and category_points.player_id=match_detail.player_id
          and category_points.category=match_detail.position
        where match_detail.season_id=p_season_id and match_detail.player_id=detail.player_id
          and match_detail.position=detail.position
        group by match_detail.session_id,match_detail.player_id,match_detail.position,
          category_points.nomination_points
      ) session_rating) average_session_rating,
      (select count(*) from public.valid_performance_votes vote
        join public.sessions session on session.id=vote.session_id
        where session.season_id=p_season_id and vote.player_id=detail.player_id
          and vote.category=detail.position) nominations
    from public.match_performance_detail detail
    where detail.season_id=p_season_id and detail.position is not null
    group by detail.player_id,detail.player_name,detail.position
  ) r),'[]'::jsonb);
$$;

create or replace function public.submit_session_performance_nomination(
  p_session_id uuid,p_category text,p_player_id uuid
) returns void language plpgsql security definer set search_path=public as $$
declare session public.sessions; voter_player uuid;
begin
  select * into session from public.sessions where id=p_session_id for update;
  if not coalesce(public.performance_access(session.program_id),false) then
    raise exception 'Program access required';
  end if;
  if session.status<>'completed' then raise exception 'Nominations open after session completion'; end if;
  if exists(select 1 from public.session_performance_voting where session_id=session.id and closed) then
    raise exception 'Nominations are closed';
  end if;
  if p_category is null or p_category not in('goalkeeper','defender','midfielder') then
    raise exception 'Select Top Goalkeeper, Top Defender, or Top Midfielder';
  end if;
  select member.player_id into voter_player
  from public.program_members member
  where member.program_id=session.program_id and member.profile_id=auth.uid()
    and member.status='active' and member.player_id is not null;
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
        and eligible.position=p_category) then
    raise exception 'The nominee must have participated at the selected position';
  end if;
  if exists(select 1 from public.valid_session_performance_nominations nomination
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

create function public.authorize_session_performance_nominator(
  p_session_id uuid,p_player_id uuid,p_authorized boolean
) returns void language plpgsql security definer set search_path=public as $$
declare session public.sessions;
begin
  select * into session from public.sessions where id=p_session_id for update;
  if not coalesce(public.performance_access(session.program_id)
      and public.program_role(session.program_id)='manager',false) then
    raise exception 'Manager access required';
  end if;
  if exists(select 1 from public.session_performance_voting where session_id=session.id and closed) then
    raise exception 'Nominations are closed';
  end if;
  if p_authorized is null then raise exception 'Authorization choice is required'; end if;
  if not exists(select 1 from public.program_members member
      where member.program_id=session.program_id and member.player_id=p_player_id
        and member.status='active') then
    raise exception 'Select an active program player';
  end if;
  if p_authorized and exists(select 1 from public.session_team_players participant
      where participant.session_id=session.id and participant.player_id=p_player_id) then
    raise exception 'Session participants are already eligible to nominate';
  end if;
  if p_authorized then
    insert into public.session_performance_nominator_authorizations(session_id,player_id,authorized_by)
    values(session.id,p_player_id,auth.uid())
    on conflict(session_id,player_id) do update set authorized_by=excluded.authorized_by,created_at=now();
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

create or replace function public.session_performance(p_session_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare session public.sessions; answer jsonb; current_voter uuid;
begin
  select * into session from public.sessions where id=p_session_id;
  if not coalesce(public.performance_access(session.program_id),false) then
    raise exception 'Program access required';
  end if;
  select member.player_id into current_voter from public.program_members member
  where member.program_id=session.program_id and member.profile_id=auth.uid()
    and member.status='active' and member.player_id is not null;
  select jsonb_build_object(
    'session',jsonb_build_object('id',session.id,'name',session.name,'status',session.status,'seasonId',session.season_id),
    'canManage',public.program_role(session.program_id) in('manager','captain')
      and public.is_program_module_enabled(session.program_id,'scores'),
    'canClose',public.program_role(session.program_id)='manager',
    'canAuthorizeVoters',public.program_role(session.program_id)='manager',
    'canNominate',current_voter is not null and session.status='completed'
      and not coalesce((select closed from public.session_performance_voting where session_id=session.id),false)
      and (exists(select 1 from public.session_team_players participant
          where participant.session_id=session.id and participant.player_id=current_voter)
        or exists(select 1 from public.session_performance_nominator_authorizations authz
          where authz.session_id=session.id and authz.player_id=current_voter)),
    'voterPlayerId',current_voter,
    'closed',coalesce((select closed from public.session_performance_voting where session_id=session.id),false),
    'teams',coalesce((select jsonb_agg(jsonb_build_object(
      'id',team.id,'name',team.name,
      'canVote',exists(select 1 from public.program_members member
        where member.program_id=session.program_id and member.profile_id=auth.uid()
          and member.status='active' and member.player_id=team.captain_player_id),
      'players',(select coalesce(jsonb_agg(jsonb_build_object('id',player.id,'name',player.display_name)),
          '[]'::jsonb)
        from public.session_team_players roster join public.players player on player.id=roster.player_id
        where roster.session_team_id=team.id)
    ) order by team.name) from public.session_teams team where team.session_id=session.id),'[]'::jsonb),
    'voters',coalesce((select jsonb_agg(jsonb_build_object(
      'playerId',player.id,'name',player.display_name,
      'participated',exists(select 1 from public.session_team_players roster
        where roster.session_id=session.id and roster.player_id=player.id),
      'authorized',exists(select 1 from public.session_performance_nominator_authorizations authz
        where authz.session_id=session.id and authz.player_id=player.id)
    ) order by player.display_name,player.id)
      from public.program_members member join public.players player on player.id=member.player_id
      where member.program_id=session.program_id and member.status='active'
        and member.player_id is not null and public.program_role(session.program_id)='manager'),'[]'::jsonb),
    'matches',coalesce((select jsonb_agg(jsonb_build_object(
      'id',match.id,'number',match.match_number,'teamAId',match.team_a_id,'teamBId',match.team_b_id,
      'teamAName',coalesce(team_a.name,case match.team_a_source when 'standings_rank_1' then '1st place' else 'Team A' end),
      'teamBName',coalesce(team_b.name,case match.team_b_source when 'standings_rank_2' then '2nd place' else 'Team B' end),
      'status',match.result_status) order by match.match_number)
      from public.session_matches match
      left join public.session_teams team_a on team_a.id=match.team_a_id
      left join public.session_teams team_b on team_b.id=match.team_b_id
      where match.session_id=session.id),'[]'::jsonb),
    'positions',coalesce((select jsonb_agg(jsonb_build_object(
      'match_id',match.id,'player_id',roster.player_id,'session_team_id',roster.session_team_id,
      'position',public.resolved_match_player_position(match.id,roster.player_id),
      'confirmed_position',match_position.position,'score_position',score_position.position,
      'goalkeeper_assigned',exists(select 1 from public.goals goal
        where goal.match_id=match.id and goal.conceded_goalkeeper_id=roster.player_id),
      'participated',coalesce(match_position.participated,true)
    ) order by match.match_number,player.display_name,player.id)
      from public.session_matches match
      join public.session_team_players roster on roster.session_id=session.id
        and roster.session_team_id in(match.team_a_id,match.team_b_id)
      join public.players player on player.id=roster.player_id
      left join public.match_player_positions match_position
        on match_position.match_id=match.id and match_position.player_id=roster.player_id
      left join public.match_score_positions score_position
        on score_position.match_id=match.id and score_position.player_id=roster.player_id
      where match.session_id=session.id),'[]'::jsonb),
    'results',coalesce((select jsonb_agg(to_jsonb(result) order by final_rating desc,player_name)
      from public.session_performance_results result where result.session_id=session.id),'[]'::jsonb),
    'details',coalesce((select jsonb_agg(to_jsonb(detail) order by match_number,player_name)
      from public.match_performance_detail detail where detail.session_id=session.id),'[]'::jsonb),
    'votes',coalesce((select jsonb_agg(to_jsonb(vote)) from public.valid_performance_votes vote
      where vote.session_id=session.id),'[]'::jsonb),
    'nominations',coalesce((select jsonb_agg(jsonb_build_object('category',nomination.category,
        'player_id',nomination.player_id))
      from public.valid_session_performance_nominations nomination
      where nomination.session_id=session.id and nomination.voter_id=auth.uid()),'[]'::jsonb),
    'voteCounts',coalesce((select jsonb_agg(jsonb_build_object(
        'category',counts.category,'total',counts.total_votes,'pointsPerVote',counts.points_per_vote))
      from (select category,total_votes,least(20::numeric,60::numeric/total_votes) points_per_vote
        from (select category,count(*)::numeric total_votes from public.valid_performance_votes
          where session_id=session.id group by category) grouped) counts),'[]'::jsonb),
    'awards',coalesce((select jsonb_agg(to_jsonb(winner) order by category,player_name) from (
      select category,player_id,player.display_name player_name,count(*) nominations,
        dense_rank() over(partition by category order by count(*) desc) rank
      from public.valid_performance_votes vote join public.players player on player.id=vote.player_id
      where vote.session_id=session.id group by category,player_id,player.display_name
    ) winner where rank=1),'[]'::jsonb)
  ) into answer;
  return answer;
end;
$$;

create or replace function public.season_performance(p_season_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare program uuid;
begin
  select program_id into program from public.seasons where id=p_season_id;
  if not coalesce(public.performance_access(program),false) then raise exception 'Program access required'; end if;
  return public.performance_season_rows(p_season_id);
end;
$$;

revoke all on public.valid_session_performance_nominations,public.session_category_nomination_points,
  public.session_player_nomination_points from public,anon,authenticated;
revoke all on function public.submit_session_performance_nomination(uuid,text,uuid),
  public.authorize_session_performance_nominator(uuid,uuid,boolean) from public,anon;
grant execute on function public.submit_session_performance_nomination(uuid,text,uuid),
  public.authorize_session_performance_nominator(uuid,uuid,boolean) to authenticated;
