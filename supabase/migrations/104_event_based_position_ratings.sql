alter table public.goals
  add column if not exists player_position text
  check (player_position is null or player_position in ('goalkeeper','defender','midfielder','forward'));

update public.goals goal
set player_position=score.position
from public.match_score_positions score
where score.match_id=goal.match_id and score.player_id=goal.scorer_id
  and goal.player_position is null;

create or replace function public.public_save_game_scores(p_session_id uuid, p_games jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  game_item jsonb;
  goal_item jsonb;
  saved_match_id uuid;
  saved_match_number integer;
  saved_display_order integer;
  saved_match_type text;
  saved_team_a_source text;
  saved_team_b_source text;
  team_a_id uuid;
  team_b_id uuid;
  away_team_id uuid;
  scheduled_start_time time;
  scheduled_end_time time;
  scorer_id uuid;
  assist_player_id uuid;
  scorer_team_id uuid;
  assist_team_id uuid;
  scoring_team_id uuid;
  goal_type text;
  goal_count integer;
  player_position text;
  calculated_team_a_score integer;
  calculated_team_b_score integer;
  saved_games integer := 0;
begin
  if not coalesce((select public.performance_access(program_id) and public.program_role(program_id) in ('manager','captain') from public.sessions where id=p_session_id),false) then raise exception 'Score management access required'; end if;
  perform 1 from public.sessions where id=p_session_id for update;
  if p_session_id is null or not exists (select 1 from public.sessions where id = p_session_id) then
    return jsonb_build_object('error', 'Session was not found.');
  end if;

  if exists (
    select 1
    from public.sessions
    where id = p_session_id
      and public.program_role(program_id) <> 'manager'
      and (status = 'completed' or session_date < (now() at time zone 'America/Toronto')::date)
  ) then
    return jsonb_build_object('error', 'Scores are read-only because this session is completed or past its date.');
  end if;

  if jsonb_typeof(coalesce(p_games, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object('error', 'Game score data is invalid.');
  end if;

  delete from public.goals
  where session_id = p_session_id
    and (public.goals.match_id is not null or (public.goals.match_id is null and public.goals.session_team_id is null));
  delete from public.session_matches where session_id = p_session_id and match_number not in
    (select (value->>'matchNumber')::integer from jsonb_array_elements(p_games));

  for game_item in select value from jsonb_array_elements(coalesce(p_games, '[]'::jsonb))
  loop
    if not coalesce(game_item->>'teamAId', '') ~* '^[0-9a-f-]{36}$'
      or not coalesce(game_item->>'teamBId', '') ~* '^[0-9a-f-]{36}$'
    then
      continue;
    end if;

    saved_match_number := case
      when coalesce(game_item->>'matchNumber', '') ~ '^[0-9]+$' then greatest(1, (game_item->>'matchNumber')::integer)
      else saved_games + 1
    end;
    saved_display_order := case
      when coalesce(game_item->>'displayOrder', '') ~ '^[0-9]+$' then greatest(1, (game_item->>'displayOrder')::integer)
      else saved_match_number
    end;
    saved_match_type := case when game_item->>'matchType' = 'final' then 'final' else 'regular' end;
    saved_team_a_source := case when game_item->>'teamASource' = 'standings_rank_1' then 'standings_rank_1' else null end;
    saved_team_b_source := case when game_item->>'teamBSource' = 'standings_rank_2' then 'standings_rank_2' else null end;
    team_a_id := (game_item->>'teamAId')::uuid;
    team_b_id := (game_item->>'teamBId')::uuid;
    away_team_id := null;
    scheduled_start_time := case
      when coalesce(game_item->>'scheduledStartTime', '') ~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$' then (game_item->>'scheduledStartTime')::time
      else null
    end;
    scheduled_end_time := case
      when coalesce(game_item->>'scheduledEndTime', '') ~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$' then (game_item->>'scheduledEndTime')::time
      else null
    end;
    calculated_team_a_score := 0;
    calculated_team_b_score := 0;

    if team_a_id = team_b_id then
      continue;
    end if;

    if coalesce(game_item->>'awayTeamId', '') ~* '^[0-9a-f-]{36}$'
      and (game_item->>'awayTeamId')::uuid in (team_a_id, team_b_id)
    then
      away_team_id := (game_item->>'awayTeamId')::uuid;
    end if;

    if not exists (select 1 from public.session_teams where id = team_a_id and session_id = p_session_id)
      or not exists (select 1 from public.session_teams where id = team_b_id and session_id = p_session_id)
    then
      continue;
    end if;

    insert into public.session_matches(
      session_id, match_number, display_order, match_type, team_a_id, team_b_id,
      team_a_source, team_b_source, away_team_id, scheduled_start_time, scheduled_end_time,
      result_status, team_a_score, team_b_score
    )
    values (
      p_session_id, saved_match_number, saved_display_order, saved_match_type,
      team_a_id, team_b_id, saved_team_a_source, saved_team_b_source, away_team_id,
      scheduled_start_time, scheduled_end_time,
      case when game_item->>'resultStatus' = 'played' then 'played' else 'scheduled' end, 0, 0
    )
    on conflict (session_id, match_number) do update
    set display_order = excluded.display_order,
      match_type = excluded.match_type,
      team_a_id = excluded.team_a_id,
      team_b_id = excluded.team_b_id,
      team_a_source = excluded.team_a_source,
      team_b_source = excluded.team_b_source,
      away_team_id = excluded.away_team_id,
      scheduled_start_time = excluded.scheduled_start_time,
      scheduled_end_time = excluded.scheduled_end_time,
      result_status = excluded.result_status,
      team_a_score = 0,
      team_b_score = 0
    returning id into saved_match_id;

    delete from public.match_score_positions where match_id=saved_match_id;

    for goal_item in
      select value
      from jsonb_array_elements(
        case when jsonb_typeof(game_item->'goals') = 'array' then game_item->'goals' else '[]'::jsonb end
      )
    loop
      if not coalesce(goal_item->>'scorerId', '') ~* '^[0-9a-f-]{36}$' then
        continue;
      end if;

      scorer_id := (goal_item->>'scorerId')::uuid;
      select session_team_id into scorer_team_id
      from public.session_team_players
      where session_id = p_session_id and player_id = scorer_id
      limit 1;
      if scorer_team_id is null or scorer_team_id not in (team_a_id, team_b_id) then
        continue;
      end if;

      goal_type := case when goal_item->>'goalType' = 'own_goal' then 'own_goal' else 'goal' end;
      scoring_team_id := case
        when goal_type = 'own_goal' and scorer_team_id = team_a_id then team_b_id
        when goal_type = 'own_goal' and scorer_team_id = team_b_id then team_a_id
        else scorer_team_id
      end;
      goal_count := case
        when coalesce(goal_item->>'goalCount', '') ~ '^[0-9]+$' then greatest(1, (goal_item->>'goalCount')::integer)
        else 1
      end;
      player_position := nullif(lower(btrim(goal_item->>'position')), '');
      if player_position is not null and player_position not in ('goalkeeper','defender','midfielder','forward') then
        raise exception 'Invalid scoring position';
      end if;
      assist_player_id := null;
      assist_team_id := null;

      if goal_type = 'goal' and coalesce(goal_item->>'assistPlayerId', '') ~* '^[0-9a-f-]{36}$' then
        select player_id, session_team_id into assist_player_id, assist_team_id
        from public.session_team_players
        where session_id = p_session_id and player_id = (goal_item->>'assistPlayerId')::uuid
        limit 1;
        if assist_team_id is distinct from scorer_team_id then
          assist_player_id := null;
        end if;
      end if;

      insert into public.goals(
        session_id, match_id, scorer_id, assist_player_id, conceded_goalkeeper_id,
        player_position, session_team_id, goal_type, goal_count, notes
      )
      values (
        p_session_id, saved_match_id, scorer_id, assist_player_id,
        nullif(goal_item->>'concededGoalkeeperId','')::uuid, player_position,
        scoring_team_id, goal_type, goal_count,
        case when goal_type = 'own_goal' then 'Own goal' else null end
      );

      if player_position is not null then
        insert into public.match_score_positions(match_id,player_id,position)
        values(saved_match_id,scorer_id,player_position)
        on conflict(match_id,player_id) do update set position=excluded.position,updated_at=now();
      end if;

      if scoring_team_id = team_a_id then
        calculated_team_a_score := calculated_team_a_score + goal_count;
      elsif scoring_team_id = team_b_id then
        calculated_team_b_score := calculated_team_b_score + goal_count;
      end if;
    end loop;

    update public.session_matches
    set team_a_score = calculated_team_a_score, team_b_score = calculated_team_b_score
    where id = saved_match_id;
    saved_games := saved_games + 1;
  end loop;

  if saved_games = 0 then
    raise exception 'No valid games were saved. Select two different teams for at least one game.';
  end if;
  return jsonb_build_object('success', true, 'savedGames', saved_games);
end;
$$;

create or replace function public.save_website_game_scores(p_session_id uuid,p_games jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare program uuid;
begin
  select program_id into program from public.sessions where id=p_session_id;
  if auth.uid() is null or public.program_role(program) not in('manager','captain') then raise exception 'Unauthorized'; end if;
  if not public.is_program_module_enabled(program,'scores') then raise exception 'Scores are disabled for this program'; end if;
  return public.save_program_game_scores(p_session_id,p_games);
end;
$$;
revoke all on function public.save_website_game_scores(uuid,jsonb) from public,anon;
grant execute on function public.save_website_game_scores(uuid,jsonb) to authenticated;

create or replace function public.public_game_score_editor(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'session', jsonb_build_object(
      'id', sessions.id, 'name', sessions.name, 'sessionDate', sessions.session_date,
      'startTime', sessions.start_time, 'endTime', sessions.end_time, 'status', sessions.status
    ),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', team.id, 'name', team.name,
        'players', coalesce((
          select jsonb_agg(jsonb_build_object('id', player.id, 'name', player.display_name) order by player.display_name)
          from public.session_team_players roster join public.players player on player.id=roster.player_id
          where roster.session_team_id=team.id
        ),'[]'::jsonb)
      ) order by team.name)
      from public.session_teams team where team.session_id=sessions.id
    ),'[]'::jsonb),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', match.id, 'matchNumber', match.match_number, 'displayOrder', match.display_order,
        'matchType', match.match_type, 'teamAId', match.team_a_id, 'teamBId', match.team_b_id,
        'teamASource', match.team_a_source, 'teamBSource', match.team_b_source,
        'awayTeamId', match.away_team_id, 'resultStatus', match.result_status,
        'scheduledStartTime', match.scheduled_start_time, 'scheduledEndTime', match.scheduled_end_time,
        'goals', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', goal.id, 'scorerId', goal.scorer_id, 'assistPlayerId', goal.assist_player_id,
            'concededGoalkeeperId', goal.conceded_goalkeeper_id, 'playerPosition', goal.player_position,
            'goalType', goal.goal_type, 'goalCount', goal.goal_count
          ) order by goal.created_at,goal.id)
          from public.goals goal where goal.match_id=match.id
        ),'[]'::jsonb)
      ) order by match.display_order nulls last,match.match_number)
      from public.session_matches match where match.session_id=sessions.id
    ),'[]'::jsonb)
  )
  from public.sessions
  where sessions.id=p_session_id;
$$;

create or replace function public.validate_conceded_goalkeeper() returns trigger
language plpgsql set search_path=public as $$
begin
  if new.conceded_goalkeeper_id is not null and not exists (
    select 1
    from public.session_matches match
    join public.session_team_players roster on roster.session_id=match.session_id
      and roster.player_id=new.conceded_goalkeeper_id
    where match.id=new.match_id
      and ((new.session_team_id=match.team_a_id and roster.session_team_id=match.team_b_id)
        or (new.session_team_id=match.team_b_id and roster.session_team_id=match.team_a_id))
  ) then
    raise exception 'Select an opposing goalkeeper from the opposing team roster';
  end if;
  return new;
end;
$$;

create or replace function public.match_performance_points_v2(
  p_positions text[],p_for integer,p_against integer,p_goals integer,p_assists integer,
  p_keeper_conceded integer,p_keeper_assignment_incomplete boolean
) returns jsonb language sql immutable as $$
  with selected as (
    select distinct selected_position.position
    from unnest(coalesce(p_positions,'{}'::text[])) as selected_position(position)
    where selected_position.position in ('goalkeeper','defender','midfielder','forward')
  ), bases as (
    select position,
      case position
        when 'goalkeeper' then 8::numeric/(1+0.5*coalesce(p_keeper_conceded,0))
        when 'defender' then 6::numeric/(1+0.5*coalesce(p_against,0))
        when 'midfielder' then 0.75*least(coalesce(p_for,0),4)+case when coalesce(p_against,0)=0 then 2 else 0 end
        when 'forward' then 0.75*least(coalesce(p_for,0),4)
      end
      +case when coalesce(p_for,0)>coalesce(p_against,0) then 2
        when coalesce(p_for,0)=coalesce(p_against,0) then 1 else 0 end base,
      case position when 'goalkeeper' then 2 when 'defender' then 2
        when 'midfielder' then 3 else 5 end contribution_cap
    from selected
  ), totals as (
    select count(*)::integer position_count,
      avg(base) position_base,
      max(contribution_cap) contribution_cap
    from bases
  ), rating_parts as (
    select position_count,position_base,
      least(coalesce(contribution_cap,0)::numeric,2*coalesce(p_goals,0)+coalesce(p_assists,0)) individual,
      coalesce(p_keeper_assignment_incomplete,false) provisional
    from totals
  )
  select case when position_count=0 then jsonb_build_object('version',2,'rating',null,'provisional',false)
    else jsonb_build_object(
      'version',2,
      'position_base',round(position_base,4),
      'individual',individual,
      'rating',least(10,position_base+individual),
      'provisional',provisional,
      'keeper_assignment_incomplete',provisional
    ) end
  from rating_parts;
$$;

create or replace view public.match_performance_detail as
with player_positions as (
  select match_id,player_id,array_agg(distinct position order by position) positions
  from (
    select goal.match_id,goal.scorer_id player_id,goal.player_position position
    from public.goals goal
    where goal.match_id is not null and goal.player_position is not null
    union
    select goal.match_id,goal.conceded_goalkeeper_id player_id,'goalkeeper'::text position
    from public.goals goal
    where goal.match_id is not null and goal.conceded_goalkeeper_id is not null
  ) scoring
  group by match_id,player_id
), facts as (
  select session.id session_id,session.season_id,session.program_id,match.id match_id,match.match_number,
    roster.player_id,player.display_name player_name,roster.session_team_id,
    resolved.positions,
    array_to_string(resolved.positions,' + ') position,
    case when roster.session_team_id=match.team_a_id then match.team_a_score else match.team_b_score end goals_for,
    case when roster.session_team_id=match.team_a_id then match.team_b_score else match.team_a_score end goals_against,
    coalesce(individual.goals,0)::integer goals,coalesce(individual.assists,0)::integer assists,
    case when resolved.positions @> array['goalkeeper']::text[] then coalesce(keeper.conceded,0)::integer end keeper_conceded,
    false clean_sheet,
    coalesce(attribution.attributed,0)<case when roster.session_team_id=match.team_a_id
      then match.team_b_score else match.team_a_score end
      and resolved.positions @> array['goalkeeper']::text[] keeper_attribution_incomplete
  from public.session_matches match
  join public.sessions session on session.id=match.session_id
  join public.session_team_players roster on roster.session_id=session.id
    and roster.session_team_id in(match.team_a_id,match.team_b_id)
  join public.players player on player.id=roster.player_id
  left join player_positions scoring on scoring.match_id=match.id and scoring.player_id=roster.player_id
  left join lateral (
    select case lower(btrim(slot.value->>'position'))
      when 'goalkeeper' then 'goalkeeper' when 'defender' then 'defender'
      when 'midfielder' then 'midfielder' when 'forward' then 'forward' end position
    from public.session_team_lineups lineup
    cross join lateral jsonb_array_elements(coalesce(lineup.positions,'[]'::jsonb)) slot(value)
    where lineup.session_id=session.id and lineup.session_team_id=roster.session_team_id
      and slot.value->>'playerId'=roster.player_id::text
    limit 1
  ) lineup on true
  cross join lateral (
    select coalesce(scoring.positions,
      case when lineup.position is not null then array[lineup.position]::text[] end,
      case lower(btrim(player.preferred_position))
        when 'goalkeeper' then array['goalkeeper']::text[]
        when 'defender' then array['defender']::text[]
        when 'midfielder' then array['midfielder']::text[]
        when 'forward' then array['forward']::text[] end
    ) positions
  ) resolved
  left join lateral (
    select sum(goal.goal_count) filter(where goal.scorer_id=roster.player_id and goal.goal_type='goal') goals,
      sum(goal.goal_count) filter(where goal.assist_player_id=roster.player_id and goal.goal_type='goal') assists
    from public.goals goal where goal.match_id=match.id
  ) individual on true
  left join lateral (
    select sum(goal.goal_count) conceded
    from public.goals goal where goal.match_id=match.id and goal.conceded_goalkeeper_id=roster.player_id
  ) keeper on true
  left join lateral (
    select sum(goal.goal_count) attributed
    from public.goals goal
    where goal.match_id=match.id and goal.session_team_id<>roster.session_team_id
      and goal.conceded_goalkeeper_id is not null
  ) attribution on true
  where match.result_status='played'
), scored as (
  select facts.*,
    public.match_performance_points_v2(
      positions,goals_for,goals_against,goals,assists,keeper_conceded,keeper_attribution_incomplete
    ) breakdown
  from facts
)
select session_id,season_id,program_id,match_id,match_number,player_id,player_name,session_team_id,
  position,goals_for,goals_against,goals,assists,keeper_conceded,clean_sheet,
  keeper_attribution_incomplete,breakdown,positions
from scored;

create or replace view public.valid_session_performance_nominations as
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
and exists(select 1 from public.match_performance_detail detail
  where detail.session_id=session.id and detail.player_id=nomination.player_id
    and detail.positions @> array[nomination.category]::text[])
and nomination.voter_player_id<>nomination.player_id;

create or replace view public.valid_performance_votes as
select legacy.session_id,legacy.captain_team_id,legacy.category,legacy.player_id,legacy.voter_id,legacy.updated_at
from public.captain_performance_votes legacy
join public.sessions session on session.id=legacy.session_id and session.status='completed'
join public.session_teams captain on captain.id=legacy.captain_team_id and captain.session_id=session.id
where exists(select 1 from public.program_members member where member.program_id=session.program_id
  and member.profile_id=legacy.voter_id and member.status='active' and member.player_id=captain.captain_player_id)
and exists(select 1 from public.match_performance_detail detail
  where detail.session_id=session.id and detail.player_id=legacy.player_id
    and detail.positions @> array[legacy.category]::text[])
and not exists(select 1 from public.session_team_players own
  where own.session_id=session.id and own.session_team_id=captain.id and own.player_id=legacy.player_id)
and not exists(select 1 from public.valid_session_performance_nominations nomination
  where nomination.session_id=legacy.session_id and nomination.voter_id=legacy.voter_id
    and nomination.category=legacy.category)
union all
select nomination.session_id,null::uuid,nomination.category,nomination.player_id,
  nomination.voter_id,nomination.created_at
from public.valid_session_performance_nominations nomination;

create or replace view public.session_performance_results as
with totals as (
  select detail.session_id,detail.season_id,detail.program_id,detail.player_id,detail.player_name,
    count(*)::integer matches_played,
    count(*) filter(where detail.positions is not null)::integer rated_matches,
    sum(coalesce((detail.breakdown->>'rating')::numeric,0))*4/count(*) match_points,
    sum(detail.goals)::integer goals,sum(detail.assists)::integer assists,
    count(*) filter(where detail.clean_sheet)::integer clean_sheets,
    sum(detail.keeper_conceded)::integer keeper_conceded,
    bool_or(detail.positions is null or detail.keeper_attribution_incomplete) incomplete
  from public.match_performance_detail detail
  group by detail.session_id,detail.season_id,detail.program_id,detail.player_id,detail.player_name
), all_positions as (
  select detail.session_id,detail.player_id,array_agg(distinct role.position order by role.position) positions
  from public.match_performance_detail detail
  cross join lateral unnest(detail.positions) role(position)
  group by detail.session_id,detail.player_id
)
select totals.session_id,totals.season_id,totals.program_id,totals.player_id,totals.player_name,
  totals.matches_played,totals.rated_matches,all_positions.positions,totals.match_points,
  round(coalesce(nomination.nomination_points,0))::integer captain_points,
  totals.match_points+coalesce(nomination.nomination_points,0) final_rating,
  totals.goals,totals.assists,totals.clean_sheets,totals.keeper_conceded,totals.incomplete,
  coalesce(nomination.nomination_points,0)::numeric nomination_points
from totals
left join all_positions using(session_id,player_id)
left join public.session_player_nomination_points nomination
  on nomination.session_id=totals.session_id and nomination.player_id=totals.player_id;

create or replace function public.submit_session_performance_nomination(
  p_session_id uuid,p_category text,p_player_id uuid
) returns void language plpgsql security definer set search_path=public as $$
declare session public.sessions; voter_player uuid;
begin
  select * into session from public.sessions where id=p_session_id for update;
  if not coalesce(public.performance_access(session.program_id),false) then raise exception 'Program access required'; end if;
  if session.status<>'completed' then raise exception 'Nominations open after session completion'; end if;
  if exists(select 1 from public.session_performance_voting where session_id=session.id and closed) then raise exception 'Nominations are closed'; end if;
  if p_category is null or p_category not in('goalkeeper','defender','midfielder') then raise exception 'Select Top Goalkeeper, Top Defender, or Top Midfielder'; end if;
  select member.player_id into voter_player from public.program_members member
  where member.program_id=session.program_id and member.profile_id=auth.uid() and member.status='active' and member.player_id is not null;
  if voter_player is null then raise exception 'Link your account to a player profile to nominate'; end if;
  if not exists(select 1 from public.session_team_players participant where participant.session_id=session.id and participant.player_id=voter_player)
    and not exists(select 1 from public.session_performance_nominator_authorizations authz where authz.session_id=session.id and authz.player_id=voter_player)
    then raise exception 'You are not authorized to nominate for this session'; end if;
  if p_player_id=voter_player then raise exception 'You cannot nominate yourself'; end if;
  if not exists(select 1 from public.match_performance_detail eligible
    where eligible.session_id=session.id and eligible.player_id=p_player_id
      and eligible.positions @> array[p_category]::text[])
    then raise exception 'The nominee must have participated at the selected position'; end if;
  if exists(select 1 from public.valid_session_performance_nominations nomination
    where nomination.session_id=session.id and nomination.voter_player_id=voter_player and nomination.category=p_category)
    then raise exception 'You have already nominated in this category'; end if;
  insert into public.session_performance_nominations(session_id,voter_id,voter_player_id,category,player_id)
  values(session.id,auth.uid(),voter_player,p_category,p_player_id)
  on conflict(session_id,voter_player_id,category) do update
    set voter_id=excluded.voter_id,player_id=excluded.player_id,created_at=now();
  insert into public.performance_changes(session_id,actor_id,action,details)
  values(session.id,auth.uid(),'player_nomination',jsonb_build_object('voterPlayerId',voter_player,'category',p_category,'playerId',p_player_id));
end;
$$;

create or replace function public.nominate_session_player(
  p_session_id uuid,p_team_id uuid,p_category text,p_player_id uuid
) returns void language plpgsql security definer set search_path=public as $$
declare session public.sessions;
begin
  select * into session from public.sessions where id=p_session_id for update;
  if not coalesce(public.performance_access(session.program_id),false) then raise exception 'Program access required'; end if;
  if session.status<>'completed' then raise exception 'Voting opens after session completion'; end if;
  if exists(select 1 from public.session_performance_voting where session_id=session.id and closed) then raise exception 'Voting is closed'; end if;
  if not exists(select 1 from public.session_teams team join public.program_members member
    on member.program_id=session.program_id and member.player_id=team.captain_player_id
    and member.profile_id=auth.uid() and member.status='active'
    where team.id=p_team_id and team.session_id=session.id) then raise exception 'Only this team captain may vote'; end if;
  if exists(select 1 from public.session_team_players where session_id=session.id and session_team_id=p_team_id and player_id=p_player_id)
    or not exists(select 1 from public.match_performance_detail where session_id=session.id and player_id=p_player_id
      and positions @> array[p_category]::text[])
    then raise exception 'Nominee must have played this position on another team'; end if;
  insert into public.captain_performance_votes(session_id,captain_team_id,category,player_id,voter_id)
  values(session.id,p_team_id,p_category,p_player_id,auth.uid())
  on conflict(session_id,captain_team_id,category) do update
    set player_id=excluded.player_id,voter_id=auth.uid(),updated_at=now();
  insert into public.performance_changes(session_id,actor_id,action,details)
  values(session.id,auth.uid(),'nomination',jsonb_build_object('teamId',p_team_id,'category',p_category,'playerId',p_player_id));
end;
$$;

create or replace function public.performance_season_rows(p_season_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce((select jsonb_agg(to_jsonb(row_data) order by position,average_session_rating desc,player_name) from (
    select detail.player_id,detail.player_name,role.position,count(*) matches_played,
      count(distinct detail.session_id) sessions_played,
      avg((detail.breakdown->>'rating')::numeric) average_match_rating,
      (select avg(session_rating.points) from (
        select avg((match_detail.breakdown->>'rating')::numeric)*4
          +coalesce(category_points.nomination_points,0) points
        from public.match_performance_detail match_detail
        left join public.session_category_nomination_points category_points
          on category_points.session_id=match_detail.session_id
          and category_points.player_id=match_detail.player_id
          and category_points.category=role.position
        where match_detail.season_id=p_season_id and match_detail.player_id=detail.player_id
          and match_detail.positions @> array[role.position]::text[]
        group by match_detail.session_id,match_detail.player_id,category_points.nomination_points
      ) session_rating) average_session_rating,
      (select count(*) from public.valid_performance_votes vote
        join public.sessions session on session.id=vote.session_id
        where session.season_id=p_season_id and vote.player_id=detail.player_id
          and vote.category=role.position) nominations
    from public.match_performance_detail detail
    cross join lateral unnest(detail.positions) role(position)
    where detail.season_id=p_season_id
    group by detail.player_id,detail.player_name,role.position
  ) row_data),'[]'::jsonb);
$$;

revoke all on function public.match_performance_points_v2(text[],integer,integer,integer,integer,integer,boolean) from public,anon,authenticated;
grant execute on function public.match_performance_points_v2(text[],integer,integer,integer,integer,integer,boolean) to authenticated;
