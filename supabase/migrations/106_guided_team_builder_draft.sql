alter table public.session_team_builder_drafts
  add column if not exists draft_position_categories jsonb not null default '{}'::jsonb;

alter table public.session_team_builder_drafts
  drop constraint if exists session_team_builder_drafts_draft_mode_check;

alter table public.session_team_builder_drafts
  add constraint session_team_builder_drafts_draft_mode_check
  check (draft_mode in ('lottery', 'balanced', 'guided'));

create or replace function public.save_program_team_builder_guided_draft(
  p_session_id uuid,
  p_teams jsonb,
  p_players_per_team integer,
  p_pick_cursor integer,
  p_toss_order_keys jsonb,
  p_roulette_rotation numeric,
  p_draft_position_categories jsonb
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_program_id uuid;
  v_organization_id uuid;
  v_updated_at timestamptz;
  v_categories jsonb;
begin
  select program_id, organization_id into v_program_id, v_organization_id
  from public.sessions where id = p_session_id;
  if auth.uid() is null or public.program_role(v_program_id) not in ('manager', 'captain') then
    raise exception 'Unauthorized';
  end if;
  if not public.is_program_module_enabled(v_program_id, 'teams') then
    raise exception 'Team builder is disabled for this program';
  end if;

  perform set_config('app.authorized_program_id', v_program_id::text, true);
  perform public.save_program_team_builder_draft(
    p_session_id, p_teams, p_players_per_team, 'balanced', p_pick_cursor,
    p_toss_order_keys, p_roulette_rotation
  );

  select coalesce(jsonb_object_agg(category.key, category.value), '{}'::jsonb)
  into v_categories
  from jsonb_each(
    case when jsonb_typeof(p_draft_position_categories) = 'object'
      then p_draft_position_categories else '{}'::jsonb end
  ) as category(key, value)
  where category.key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and category.value in (
      '"goalkeeper"'::jsonb, '"defender"'::jsonb,
      '"midfielder"'::jsonb, '"forward"'::jsonb, '"unassigned"'::jsonb
    )
    and exists (
      select 1 from public.attendance attendance
      join public.players player on player.id = attendance.player_id
      where attendance.session_id = p_session_id
        and attendance.organization_id = v_organization_id
        and attendance.player_id::text = category.key
        and player.organization_id = v_organization_id
    );

  update public.session_team_builder_drafts
  set draft_mode = 'guided',
      draft_position_categories = v_categories,
      updated_by = auth.uid(),
      updated_at = now()
  where session_id = p_session_id
    and organization_id = v_organization_id
  returning updated_at into v_updated_at;

  return jsonb_build_object('updatedAt', v_updated_at);
end;
$$;

revoke all on function public.save_program_team_builder_guided_draft(uuid, jsonb, integer, integer, jsonb, numeric, jsonb) from public, anon;
grant execute on function public.save_program_team_builder_guided_draft(uuid, jsonb, integer, integer, jsonb, numeric, jsonb) to authenticated;

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
    'settings', jsonb_build_object(
      'playersPerTeam', ev.players_per_team
    ),
    'draft', (
      select jsonb_build_object(
        'teams', draft.teams,
        'playersPerTeam', draft.players_per_team,
        'draftMode', draft.draft_mode,
        'pickCursor', draft.pick_cursor,
        'tossOrderKeys', draft.toss_order_keys,
        'rouletteRotation', draft.roulette_rotation,
        'draftPositionCategories', draft.draft_position_categories,
        'updatedAt', draft.updated_at
      )
      from public.session_team_builder_drafts draft
      where draft.session_id = ss.id
        and draft.organization_id = ss.organization_id
    ),
    'players', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.display_name,
          'status', a.status,
          'preferredPosition', p.preferred_position,
          'attackingSkillPercent', rating.attacking_skill_percent,
          'defendingSkillPercent', rating.defending_skill_percent,
          'goalkeepingSkillPercent', rating.goalkeeping_skill_percent
        )
        order by p.display_name
      )
      from public.attendance a
      join public.players p on p.id = a.player_id
      left join public.player_performance_ratings rating
        on rating.player_id = p.id
       and rating.program_id = ss.program_id
       and rating.organization_id = ss.organization_id
      where a.session_id = ss.id
        and a.organization_id = ss.organization_id
        and p.organization_id = ss.organization_id
        and a.status in ('confirmed','played','replacement','waitlisted')
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', st.id,
          'name', st.name,
          'captainPlayerId', st.captain_player_id,
          'players', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', p.id,
                'name', p.display_name,
                'preferredPosition', p.preferred_position,
                'attackingSkillPercent', rating.attacking_skill_percent,
                'defendingSkillPercent', rating.defending_skill_percent,
                'goalkeepingSkillPercent', rating.goalkeeping_skill_percent
              )
              order by p.display_name
            )
            from public.session_team_players stp
            join public.players p on p.id = stp.player_id
            left join public.player_performance_ratings rating
              on rating.player_id = p.id
             and rating.program_id = ss.program_id
             and rating.organization_id = ss.organization_id
            where stp.session_team_id = st.id
              and stp.organization_id = ss.organization_id
              and p.organization_id = ss.organization_id
          ), '[]'::jsonb)
        )
        order by st.created_at, st.name
      )
      from public.session_teams st
      where st.session_id = ss.id
        and st.organization_id = ss.organization_id
    ), '[]'::jsonb)
  )
  from public.sessions ss
  join public.seasons seasons on seasons.id = ss.season_id and seasons.organization_id = ss.organization_id
  left join public.playgrounds pg on pg.id = ss.playground_id and pg.organization_id = ss.organization_id
  left join public.session_team_update_events ev on ev.session_id = ss.id and ev.organization_id = ss.organization_id
  where ss.id = p_session_id;
$$;
