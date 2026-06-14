create table if not exists public.player_performance_ratings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade default public.current_organization_id(),
  program_id uuid not null references public.programs(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  attacking_skill_percent integer check (attacking_skill_percent between 0 and 100),
  defending_skill_percent integer check (defending_skill_percent between 0 and 100),
  goalkeeping_skill_percent integer check (goalkeeping_skill_percent between 0 and 100),
  notes text,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(program_id, player_id)
);

create index if not exists player_performance_ratings_organization_id_idx
  on public.player_performance_ratings(organization_id);

create index if not exists player_performance_ratings_program_id_idx
  on public.player_performance_ratings(program_id);

create index if not exists player_performance_ratings_player_id_idx
  on public.player_performance_ratings(player_id);

drop trigger if exists player_performance_ratings_updated_at on public.player_performance_ratings;
create trigger player_performance_ratings_updated_at
  before update on public.player_performance_ratings
  for each row execute function public.set_updated_at();

create or replace function public.validate_player_performance_rating_scope()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  program_org_id uuid;
  player_org_id uuid;
begin
  select organization_id into program_org_id from public.programs where id = new.program_id;
  select organization_id into player_org_id from public.players where id = new.player_id;

  if program_org_id is null then
    raise exception 'Program not found.';
  end if;

  if player_org_id is null then
    raise exception 'Player not found.';
  end if;

  if new.organization_id <> program_org_id or new.organization_id <> player_org_id then
    raise exception 'Player performance rating must belong to one organization.';
  end if;

  return new;
end;
$$;

drop trigger if exists player_performance_ratings_scope_check on public.player_performance_ratings;
create trigger player_performance_ratings_scope_check
  before insert or update on public.player_performance_ratings
  for each row execute function public.validate_player_performance_rating_scope();

alter table public.player_performance_ratings enable row level security;

drop policy if exists "player_performance_ratings_select" on public.player_performance_ratings;
create policy "player_performance_ratings_select" on public.player_performance_ratings
  for select using (public.is_organization_member(organization_id));

drop policy if exists "player_performance_ratings_admin_all" on public.player_performance_ratings;
create policy "player_performance_ratings_admin_all" on public.player_performance_ratings
  for all using (public.organization_role(organization_id) = 'admin')
  with check (public.organization_role(organization_id) = 'admin');

drop policy if exists "player_performance_ratings_captain_insert" on public.player_performance_ratings;
create policy "player_performance_ratings_captain_insert" on public.player_performance_ratings
  for insert with check (public.organization_role(organization_id) = 'captain');

drop policy if exists "player_performance_ratings_captain_update" on public.player_performance_ratings;
create policy "player_performance_ratings_captain_update" on public.player_performance_ratings
  for update using (public.organization_role(organization_id) = 'captain')
  with check (public.organization_role(organization_id) = 'captain');

drop policy if exists "player_performance_ratings_captain_delete" on public.player_performance_ratings;
create policy "player_performance_ratings_captain_delete" on public.player_performance_ratings
  for delete using (public.organization_role(organization_id) = 'captain');

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

grant execute on function public.public_session_team_builder(uuid) to anon, authenticated, service_role;
