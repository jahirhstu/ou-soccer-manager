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
          'teamAId', session_matches.team_a_id,
          'teamBId', session_matches.team_b_id,
          'teamAName', team_a.name,
          'teamBName', team_b.name,
          'teamAScore', session_matches.team_a_score,
          'teamBScore', session_matches.team_b_score
        )
        order by session_matches.match_number
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
        order by session_matches.match_number nulls last, scorer.display_name
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
