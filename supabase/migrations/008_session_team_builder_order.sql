create or replace function public.public_session_team_builder(p_session_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'session', jsonb_build_object(
      'id', ss.id,
      'name', ss.name,
      'sessionDate', ss.session_date,
      'location', coalesce(pg.name, ss.location),
      'status', ss.status,
      'seasonName', seasons.name
    ),
    'players', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.display_name,
          'status', a.status
        )
        order by p.display_name
      )
      from public.attendance a
      join public.players p on p.id = a.player_id
      where a.session_id = ss.id
        and a.status in ('confirmed','played','replacement','waitlisted')
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', st.id,
          'name', st.name,
          'captainPlayerId', st.captain_player_id,
          'score', st.score,
          'players', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', p.id,
                'name', p.display_name
              )
              order by p.display_name
            )
            from public.session_team_players stp
            join public.players p on p.id = stp.player_id
            where stp.session_team_id = st.id
          ), '[]'::jsonb)
        )
        order by st.created_at, st.name
      )
      from public.session_teams st
      where st.session_id = ss.id
    ), '[]'::jsonb)
  )
  from public.sessions ss
  join public.seasons seasons on seasons.id = ss.season_id
  left join public.playgrounds pg on pg.id = ss.playground_id
  where ss.id = p_session_id;
$$;

grant execute on function public.public_session_team_builder(uuid) to anon, authenticated, service_role;
