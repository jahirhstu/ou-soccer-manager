create or replace function public.scoped_public_latest_winning_streaks(
  p_organization_slug text,
  p_program_slug text default null,
  p_season_id uuid default null
)
returns table(
  player_id uuid,
  player_name text,
  season_id uuid,
  season_name text,
  streak_count integer,
  start_session_date date,
  end_session_date date,
  session_names text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select streaks.*
  from public.resolve_enabled_public_scope(p_organization_slug, p_program_slug) scope
  join public.seasons seasons
    on seasons.organization_id = scope.organization_id
   and (scope.program_id is null or seasons.program_id = scope.program_id)
   and (p_season_id is null or seasons.id = p_season_id)
  cross join lateral public.public_latest_winning_streaks(seasons.id) streaks;
$$;

grant execute on function public.scoped_public_latest_winning_streaks(text, text, uuid) to anon, authenticated, service_role;
