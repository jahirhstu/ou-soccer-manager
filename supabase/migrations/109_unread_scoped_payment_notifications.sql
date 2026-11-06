-- Only pending payment alerts should disable the public Sent button.
create or replace function public.scoped_public_payment_notification_keys(p_organization_slug text, p_program_slug text default null)
returns table(player_id uuid, season_id uuid, amount numeric)
language sql stable security definer set search_path = public as $$
  select n.player_id, n.season_id, n.amount
  from public.resolve_enabled_public_scope(p_organization_slug, p_program_slug) scope
  join public.organization_settings settings on settings.organization_id = scope.organization_id
  join public.seasons s on s.organization_id = scope.organization_id
    and (scope.program_id is null or s.program_id = scope.program_id)
  join public.notifications n on n.season_id = s.id and n.organization_id = scope.organization_id
  where n.notification_type = 'payment_sent'
    and n.read_at is null
    and settings.public_balances_enabled and settings.public_payments_enabled
    and public.is_program_module_enabled(s.program_id, 'public_reports')
    and public.is_program_module_enabled(s.program_id, 'payments');
$$;

