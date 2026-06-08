create or replace function public.resolve_public_route_context(p_organization_slug text, p_program_slug text default null)
returns table (
  organization_id uuid,
  organization_slug text,
  program_id uuid,
  program_slug text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    org.id as organization_id,
    org.slug as organization_slug,
    program.id as program_id,
    program.slug as program_slug
  from public.organizations org
  left join public.programs program
    on program.organization_id = org.id
   and program.slug = public.normalize_slug(p_program_slug)
   and program.status = 'active'
  where org.slug = public.normalize_slug(p_organization_slug)
    and (
      nullif(public.normalize_slug(p_program_slug), '') is null
      or program.id is not null
    )
  limit 1;
$$;

grant execute on function public.resolve_public_route_context(text, text) to anon, authenticated;
