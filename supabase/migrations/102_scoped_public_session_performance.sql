create function public.scoped_public_session_performance(
  p_organization_slug text,
  p_program_slug text,
  p_session_id uuid
) returns table(
  player_id uuid,
  player_name text,
  positions text[],
  final_rating numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select result.player_id, result.player_name, result.positions, result.final_rating
  from public.resolve_enabled_public_scope(p_organization_slug, p_program_slug) scope
  join public.sessions session
    on session.organization_id = scope.organization_id
   and (scope.program_id is null or session.program_id = scope.program_id)
   and session.id = p_session_id
  join public.session_performance_results result on result.session_id = session.id
  where public.is_program_module_enabled(session.program_id, 'public_reports')
  order by result.final_rating desc, result.player_name, result.player_id;
$$;

revoke all on function public.scoped_public_session_performance(text, text, uuid) from public;
grant execute on function public.scoped_public_session_performance(text, text, uuid) to anon, authenticated;
