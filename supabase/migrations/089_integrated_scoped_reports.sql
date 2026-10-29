-- Public exports and notification actions use the same enabled tenant/program scope.
create or replace function public.resolve_enabled_public_scope(p_organization_slug text, p_program_slug text default null)
returns table (organization_id uuid, program_id uuid)
language sql stable security definer set search_path = public as $$
  select org.id, program.id
  from public.organizations org
  join public.programs program on program.organization_id = org.id
    and (nullif(public.normalize_slug(p_program_slug), '') is null or program.slug = public.normalize_slug(p_program_slug))
    and program.status = 'active'
  where org.slug = public.normalize_slug(p_organization_slug)
    and org.onboarding_status = 'active' and org.public_reports_enabled
    and public.is_program_module_enabled(program.id, 'public_reports');
$$;

create or replace function public.public_report_season(p_organization_slug text default null, p_program_slug text default null)
returns table(season_id uuid, season_name text)
language sql stable security definer set search_path = public as $$
  select s.id, s.name
  from public.resolve_enabled_public_scope(p_organization_slug, p_program_slug) scope
  join public.seasons s on s.organization_id = scope.organization_id
    and (scope.program_id is null or s.program_id = scope.program_id)
  where public.is_program_module_enabled(s.program_id, 'public_reports')
  order by (s.status = 'active') desc, s.start_date desc nulls last, s.created_at desc nulls last, s.id
  limit 1;
$$;

create or replace function public.scoped_public_longest_winning_streaks(
  p_organization_slug text, p_program_slug text default null, p_season_id uuid default null
)
returns table(player_id uuid, player_name text, season_id uuid, season_name text,
  streak_count integer, start_session_date date, end_session_date date, session_names text[])
language sql stable security definer set search_path = public as $$
  select streaks.*
  from public.resolve_enabled_public_scope(p_organization_slug, p_program_slug) scope
  join public.seasons s on s.organization_id = scope.organization_id
    and (scope.program_id is null or s.program_id = scope.program_id)
    and (p_season_id is null or s.id = p_season_id)
  cross join lateral public.public_longest_winning_streaks(s.id) streaks
  where public.is_program_module_enabled(s.program_id, 'public_reports');
$$;

create or replace function public.scoped_public_payment_notification_keys(p_organization_slug text, p_program_slug text default null)
returns table(player_id uuid, season_id uuid, amount numeric)
language sql stable security definer set search_path = public as $$
  select n.player_id, n.season_id, n.amount
  from public.resolve_enabled_public_scope(p_organization_slug, p_program_slug) scope
  join public.organization_settings settings on settings.organization_id = scope.organization_id
  join public.seasons s on s.organization_id = scope.organization_id
    and (scope.program_id is null or s.program_id = scope.program_id)
  join public.notifications n on n.season_id = s.id and n.organization_id = scope.organization_id
  where settings.public_balances_enabled and settings.public_payments_enabled
    and public.is_program_module_enabled(s.program_id, 'public_reports')
    and public.is_program_module_enabled(s.program_id, 'payments');
$$;

create or replace function public.scoped_submit_payment_sent_notification(
  p_organization_slug text, p_program_slug text, p_player_id uuid, p_season_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.resolve_enabled_public_scope(p_organization_slug, p_program_slug) scope
    join public.organization_settings settings on settings.organization_id = scope.organization_id
    join public.seasons s on s.organization_id = scope.organization_id and s.id = p_season_id
      and (scope.program_id is null or s.program_id = scope.program_id)
    join public.players p on p.organization_id = scope.organization_id and p.id = p_player_id
    where settings.public_balances_enabled and settings.public_payments_enabled
      and public.is_program_module_enabled(s.program_id, 'public_reports')
      and public.is_program_module_enabled(s.program_id, 'payments')
  ) then raise exception 'Payment notifications are unavailable for this scope'; end if;
  return public.submit_payment_sent_notification(p_player_id, p_season_id);
end;
$$;

-- Financial dashboard reads must respect program membership even for tenant members.
create or replace function public.internal_scoped_player_report(p_organization_slug text, p_program_slug text default null)
returns table(player_id uuid, player_name text, season_id uuid, season_name text,
  total_paid_amount numeric, total_played_sessions numeric, confirmed_sessions numeric,
  estimated_used_amount numeric, credit_amount numeric, owes_money numeric, balance_amount numeric,
  goals integer, assists integer, appearances integer, last_attended_sessions text[], latest_session text, upcoming_session text)
language sql stable security definer set search_path = public as $$
  select report.* from public.organizations o
  join public.seasons s on s.organization_id = o.id
  join public.programs p on p.id = s.program_id
  join public.public_player_report() report on report.season_id = s.id
  where o.slug = public.normalize_slug(p_organization_slug)
    and (nullif(public.normalize_slug(p_program_slug), '') is null or p.slug = public.normalize_slug(p_program_slug))
    and public.can_manage_program_finance(p.id);
$$;

revoke all on function public.public_longest_winning_streaks(uuid) from public, anon, authenticated;
revoke all on function public.public_latest_winning_streaks(uuid) from public, anon, authenticated;
revoke all on function public.public_payment_notification_keys() from public, anon, authenticated;
revoke all on function public.submit_payment_sent_notification(uuid, uuid) from public, anon, authenticated;
revoke all on function public.scoped_public_longest_winning_streaks(text, text, uuid) from public;
revoke all on function public.scoped_public_payment_notification_keys(text, text) from public;
revoke all on function public.scoped_submit_payment_sent_notification(text, text, uuid, uuid) from public;
grant execute on function public.scoped_public_longest_winning_streaks(text, text, uuid) to anon, authenticated;
grant execute on function public.scoped_public_payment_notification_keys(text, text) to anon, authenticated;
grant execute on function public.scoped_submit_payment_sent_notification(text, text, uuid, uuid) to anon, authenticated;
