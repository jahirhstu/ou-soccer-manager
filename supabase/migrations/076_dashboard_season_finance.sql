create or replace function public.public_report_season(
  p_organization_slug text default 'ou-soccer',
  p_program_slug text default null
)
returns table(season_id uuid, season_name text)
language sql stable security definer set search_path = public as $$
  select s.id, s.name
  from public.seasons s
  join public.organizations o on o.id = s.organization_id
  left join public.programs p on p.id = s.program_id
  where o.slug = p_organization_slug and o.public_reports_enabled
    and (p_program_slug is null or p.slug = p_program_slug)
  order by (s.status = 'active') desc, s.start_date desc nulls last,
    s.created_at desc nulls last, s.id
  limit 1;
$$;

revoke all on function public.public_report_season(text, text) from public;
grant execute on function public.public_report_season(text, text) to anon, authenticated;

create or replace function public.admin_dashboard_season_finance(p_season_id uuid)
returns table(
  signup_collected numeric, drop_in_collected numeric, total_collected numeric,
  total_expenses numeric, total_refunded numeric, club_balance numeric,
  total_player_credit numeric, total_waived numeric, net_club_balance numeric,
  player_count bigint
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_season public.seasons%rowtype;
begin
  select * into v_season from public.seasons where id = p_season_id;
  if v_season.id is null or public.organization_role(v_season.organization_id) is distinct from 'admin' then
    raise exception 'Only an organization admin can view season finances';
  end if;

  return query
  with paid as (
    select coalesce(sum(p.amount) filter (where p.session_id is null), 0)::numeric signup,
      coalesce(sum(p.amount) filter (where p.session_id is not null), 0)::numeric drop_in
    from public.payments p
    where p.season_id = v_season.id and p.organization_id = v_season.organization_id and p.amount > 0
  ), spent as (
    select coalesce(sum(e.amount), 0)::numeric expenses
    from public.club_expenses e
    where e.organization_id = v_season.organization_id
      and (e.season_id = v_season.id or (e.season_id is null
        and (v_season.program_id is null or e.program_id = v_season.program_id)))
  ), refunded as (
    select coalesce(sum(le.amount), 0)::numeric refunds
    from public.ledger_entries le
    where le.season_id = v_season.id and le.organization_id = v_season.organization_id and le.type = 'refund_paid'
  ), credits as (
    select coalesce(sum(greatest(coalesce(ps.credit_amount, 0), 0)), 0)::numeric credit,
      coalesce(sum(ps.waived_amount), 0)::numeric waived
    from public.player_season_payment_summary ps where ps.season_id = v_season.id
  ), participants as (
    select a.player_id from public.attendance a join public.sessions s on s.id = a.session_id where s.season_id = v_season.id
    union
    select p.player_id from public.payments p where p.season_id = v_season.id
    union
    select le.player_id from public.ledger_entries le where le.season_id = v_season.id
  ), players as (
    select count(*) count from participants x join public.players p on p.id = x.player_id
    where p.organization_id = v_season.organization_id and p.status = 'active'
  )
  select round(paid.signup, 2), round(paid.drop_in, 2), round(paid.signup + paid.drop_in, 2),
    round(spent.expenses, 2), round(refunded.refunds, 2),
    round(paid.signup + paid.drop_in - spent.expenses - refunded.refunds, 2),
    round(credits.credit, 2), round(credits.waived, 2),
    round(paid.signup + paid.drop_in - spent.expenses - refunded.refunds - credits.credit, 2), players.count
  from paid cross join spent cross join refunded cross join credits cross join players;
end;
$$;

revoke all on function public.admin_dashboard_season_finance(uuid) from public, anon;
grant execute on function public.admin_dashboard_season_finance(uuid) to authenticated;
