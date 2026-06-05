alter table public.session_matches
  add column if not exists result_status text not null default 'scheduled';

alter table public.session_matches
  drop constraint if exists session_matches_result_status_check;

alter table public.session_matches
  add constraint session_matches_result_status_check
  check (result_status in ('scheduled', 'played'));

update public.session_matches sm
set result_status = case
  when coalesce(sm.team_a_score, 0) <> 0
    or coalesce(sm.team_b_score, 0) <> 0
    or exists (select 1 from public.goals g where g.match_id = sm.id)
  then 'played'
  else 'scheduled'
end;

create or replace function public.public_game_score_editor(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'session', jsonb_build_object(
      'id', sessions.id,
      'name', sessions.name,
      'sessionDate', sessions.session_date,
      'startTime', sessions.start_time,
      'endTime', sessions.end_time,
      'status', sessions.status
    ),
    'teams', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', session_teams.id,
          'name', session_teams.name,
          'players', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', players.id,
                'name', players.display_name
              )
              order by players.display_name
            )
            from public.session_team_players
            join public.players on players.id = session_team_players.player_id
            where session_team_players.session_team_id = session_teams.id
          ), '[]'::jsonb)
        )
        order by session_teams.name
      )
      from public.session_teams
      where session_teams.session_id = sessions.id
    ), '[]'::jsonb),
    'matches', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', session_matches.id,
          'matchNumber', session_matches.match_number,
          'displayOrder', session_matches.display_order,
          'teamAId', session_matches.team_a_id,
          'teamBId', session_matches.team_b_id,
          'awayTeamId', session_matches.away_team_id,
          'resultStatus', session_matches.result_status,
          'scheduledStartTime', session_matches.scheduled_start_time,
          'scheduledEndTime', session_matches.scheduled_end_time,
          'goals', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', goals.id,
                'scorerId', goals.scorer_id,
                'assistPlayerId', goals.assist_player_id,
                'goalType', goals.goal_type,
                'goalCount', goals.goal_count
              )
              order by goals.created_at, goals.id
            )
            from public.goals
            where goals.match_id = session_matches.id
          ), '[]'::jsonb)
        )
        order by session_matches.match_number
      )
      from public.session_matches
      where session_matches.session_id = sessions.id
    ), '[]'::jsonb)
  )
  from public.sessions
  where sessions.id = p_session_id;
$$;

grant execute on function public.public_game_score_editor(uuid) to anon, authenticated, service_role;

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
  saved_result_status text;
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
  calculated_team_a_score integer;
  calculated_team_b_score integer;
  saved_games integer := 0;
begin
  if p_session_id is null or not exists (select 1 from public.sessions where id = p_session_id) then
    return jsonb_build_object('error', 'Session was not found.');
  end if;

  if exists (
    select 1
    from public.sessions
    where id = p_session_id
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
  delete from public.session_matches where session_id = p_session_id;

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
    saved_result_status := case when game_item->>'resultStatus' = 'played' then 'played' else 'scheduled' end;
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
      session_id,
      match_number,
      display_order,
      team_a_id,
      team_b_id,
      away_team_id,
      result_status,
      scheduled_start_time,
      scheduled_end_time,
      team_a_score,
      team_b_score
    )
    values (
      p_session_id,
      saved_match_number,
      saved_display_order,
      team_a_id,
      team_b_id,
      away_team_id,
      saved_result_status,
      scheduled_start_time,
      scheduled_end_time,
      0,
      0
    )
    on conflict (session_id, match_number) do update
    set
      display_order = excluded.display_order,
      team_a_id = excluded.team_a_id,
      team_b_id = excluded.team_b_id,
      away_team_id = excluded.away_team_id,
      result_status = excluded.result_status,
      scheduled_start_time = excluded.scheduled_start_time,
      scheduled_end_time = excluded.scheduled_end_time,
      team_a_score = 0,
      team_b_score = 0
    returning id into saved_match_id;

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
        session_id,
        match_id,
        scorer_id,
        assist_player_id,
        session_team_id,
        goal_type,
        goal_count,
        notes
      )
      values (
        p_session_id,
        saved_match_id,
        scorer_id,
        assist_player_id,
        scoring_team_id,
        goal_type,
        goal_count,
        case when goal_type = 'own_goal' then 'Own goal' else null end
      );

      saved_result_status := 'played';

      if scoring_team_id = team_a_id then
        calculated_team_a_score := calculated_team_a_score + goal_count;
      elsif scoring_team_id = team_b_id then
        calculated_team_b_score := calculated_team_b_score + goal_count;
      end if;
    end loop;

    update public.session_matches
    set
      result_status = saved_result_status,
      team_a_score = calculated_team_a_score,
      team_b_score = calculated_team_b_score
    where id = saved_match_id;

    saved_games := saved_games + 1;
  end loop;

  if saved_games = 0 then
    return jsonb_build_object('error', 'No valid games were saved. Select two different teams for at least one game.');
  end if;

  return jsonb_build_object('success', true, 'savedGames', saved_games);
end;
$$;

grant execute on function public.public_save_game_scores(uuid, jsonb) to anon, authenticated, service_role;

create or replace function public.public_session_detail(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'session', jsonb_build_object(
      'id', sessions.id,
      'name', sessions.name,
      'sessionDate', sessions.session_date,
      'seasonName', seasons.name,
      'playgroundName', playgrounds.name,
      'location', sessions.location,
      'pricePerSession', sessions.price_per_session,
      'status', sessions.status
    ),
    'teams', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', session_teams.id,
          'name', session_teams.name,
          'captainName', captain.display_name,
          'players', coalesce((
            select jsonb_agg(players.display_name order by players.display_name)
            from public.session_team_players
            join public.players on players.id = session_team_players.player_id
            where session_team_players.session_team_id = session_teams.id
          ), '[]'::jsonb)
        )
        order by session_teams.name
      )
      from public.session_teams
      left join public.players captain on captain.id = session_teams.captain_player_id
      where session_teams.session_id = sessions.id
    ), '[]'::jsonb),
    'matches', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'matchNumber', session_matches.match_number,
          'displayOrder', session_matches.display_order,
          'teamAId', session_matches.team_a_id,
          'teamBId', session_matches.team_b_id,
          'awayTeamId', session_matches.away_team_id,
          'resultStatus', session_matches.result_status,
          'scheduledStartTime', session_matches.scheduled_start_time,
          'scheduledEndTime', session_matches.scheduled_end_time,
          'teamAName', team_a.name,
          'teamBName', team_b.name,
          'teamAScore', session_matches.team_a_score,
          'teamBScore', session_matches.team_b_score
        )
        order by session_matches.display_order nulls last, session_matches.match_number
      )
      from public.session_matches
      left join public.session_teams team_a on team_a.id = session_matches.team_a_id
      left join public.session_teams team_b on team_b.id = session_matches.team_b_id
      where session_matches.session_id = sessions.id
    ), '[]'::jsonb),
    'attendance', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'playerName', players.display_name,
          'status', attendance.status,
          'notes', attendance.notes
        )
        order by players.display_name
      )
      from public.attendance
      join public.players on players.id = attendance.player_id
      where attendance.session_id = sessions.id
    ), '[]'::jsonb),
    'dropouts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'originalName', original.display_name,
          'replacementName', replacement.display_name,
          'transferType', dropouts.transfer_type
        )
        order by dropouts.created_at
      )
      from public.dropouts
      join public.players original on original.id = dropouts.original_player_id
      left join public.players replacement on replacement.id = dropouts.replacement_player_id
      where dropouts.session_id = sessions.id
    ), '[]'::jsonb),
    'goals', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'goalType', goals.goal_type,
          'scorerName', scorer.display_name,
          'assistName', assist.display_name,
          'teamName', session_teams.name,
          'goalCount', goals.goal_count
        )
        order by session_matches.display_order nulls last, session_matches.match_number nulls last, scorer.display_name
      )
      from public.goals
      left join public.session_matches on session_matches.id = goals.match_id
      left join public.session_teams on session_teams.id = goals.session_team_id
      join public.players scorer on scorer.id = goals.scorer_id
      left join public.players assist on assist.id = goals.assist_player_id
      where goals.session_id = sessions.id
    ), '[]'::jsonb)
  )
  from public.sessions
  join public.seasons on seasons.id = sessions.season_id
  left join public.playgrounds on playgrounds.id = sessions.playground_id
  where sessions.id = p_session_id;
$$;

grant execute on function public.public_session_detail(uuid) to anon, authenticated, service_role;

create or replace function public.public_leaderboards()
returns table (
  board text,
  name text,
  played integer,
  wins integer,
  draws integer,
  losses integer,
  goals_for integer,
  goals_against integer,
  goal_difference integer,
  away_goals integer,
  points integer,
  points_per_game numeric,
  win_rate numeric
)
language sql
security definer
set search_path = public
as $$
  with sides as (
    select
      'team'::text board,
      team_a.name::text name,
      sm.team_a_score::integer goals_for,
      sm.team_b_score::integer goals_against,
      case when sm.away_team_id = sm.team_a_id then sm.team_a_score else 0 end::integer away_goals
    from public.session_matches sm
    join public.session_teams team_a on team_a.id = sm.team_a_id
    where sm.result_status = 'played'
    union all
    select
      'team'::text board,
      team_b.name::text name,
      sm.team_b_score::integer goals_for,
      sm.team_a_score::integer goals_against,
      case when sm.away_team_id = sm.team_b_id then sm.team_b_score else 0 end::integer away_goals
    from public.session_matches sm
    join public.session_teams team_b on team_b.id = sm.team_b_id
    where sm.result_status = 'played'
    union all
    select
      'captain'::text board,
      captain_a.display_name::text name,
      sm.team_a_score::integer goals_for,
      sm.team_b_score::integer goals_against,
      case when sm.away_team_id = sm.team_a_id then sm.team_a_score else 0 end::integer away_goals
    from public.session_matches sm
    join public.session_teams team_a on team_a.id = sm.team_a_id
    join public.players captain_a on captain_a.id = team_a.captain_player_id
    where sm.result_status = 'played'
    union all
    select
      'captain'::text board,
      captain_b.display_name::text name,
      sm.team_b_score::integer goals_for,
      sm.team_a_score::integer goals_against,
      case when sm.away_team_id = sm.team_b_id then sm.team_b_score else 0 end::integer away_goals
    from public.session_matches sm
    join public.session_teams team_b on team_b.id = sm.team_b_id
    join public.players captain_b on captain_b.id = team_b.captain_player_id
    where sm.result_status = 'played'
  ),
  grouped as (
    select
      board,
      name,
      count(*)::integer played,
      count(*) filter (where goals_for > goals_against)::integer wins,
      count(*) filter (where goals_for = goals_against)::integer draws,
      count(*) filter (where goals_for < goals_against)::integer losses,
      coalesce(sum(goals_for), 0)::integer goals_for,
      coalesce(sum(goals_against), 0)::integer goals_against,
      coalesce(sum(goals_for - goals_against), 0)::integer goal_difference,
      coalesce(sum(away_goals), 0)::integer away_goals,
      coalesce(sum(case when goals_for > goals_against then 3 when goals_for = goals_against then 1 else 0 end), 0)::integer points
    from sides
    where name is not null and length(trim(name)) > 0
    group by board, name
  )
  select
    board,
    name,
    played,
    wins,
    draws,
    losses,
    goals_for,
    goals_against,
    goal_difference,
    away_goals,
    points,
    case when played > 0 then round(points::numeric / played, 2) else 0 end points_per_game,
    case when played > 0 then round((wins::numeric / played) * 100, 0) else 0 end win_rate
  from grouped
  order by board, points desc, goal_difference desc, goals_for desc, away_goals desc, name;
$$;

grant execute on function public.public_leaderboards() to anon, authenticated, service_role;
