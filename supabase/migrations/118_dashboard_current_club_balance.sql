-- Preserve posted-charge accounting; expose a separate balance excluding upcoming fees.
create or replace function public.admin_dashboard_current_club_balance(p_season_id uuid)
returns table(current_club_balance numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_season public.seasons%rowtype;
begin
  select * into v_season from public.seasons where id = p_season_id;
  if v_season.id is null or public.can_manage_program_finance(v_season.program_id) is not true then
    raise exception 'Only an authorized program manager can view season finances';
  end if;
  return query
  with upcoming_charges as (
    select a.player_id, sum(c.amount)::numeric amount
    from public.attendance a
    join public.sessions s on s.id = a.session_id
    join public.session_player_charges c on c.session_id = s.id and c.player_id = a.player_id
    where s.season_id = v_season.id and s.organization_id = v_season.organization_id
      and s.status = 'scheduled' and a.status = 'confirmed'
      and s.session_date >= (now() at time zone 'America/Toronto')::date
    group by a.player_id
  ), current_credit as (
    -- Recover each signed balance before restoring upcoming fees. Debt must be
    -- paid off before the restored amount becomes positive player credit.
    select coalesce(sum(greatest(coalesce(ps.credit_amount, 0) - coalesce(ps.owes_money, 0)
      + coalesce(u.amount, 0), 0)), 0)::numeric amount
    from public.player_season_payment_summary ps
    left join upcoming_charges u on u.player_id = ps.player_id
    where ps.season_id = v_season.id
  )
  select round(f.club_balance - c.amount, 2)
  from public.admin_dashboard_season_finance(p_season_id) f cross join current_credit c;
end;
$$;
revoke all on function public.admin_dashboard_current_club_balance(uuid) from public, anon;
grant execute on function public.admin_dashboard_current_club_balance(uuid) to authenticated;
