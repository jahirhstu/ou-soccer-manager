create or replace view public.player_season_payment_summary
with (security_invoker = true) as
with payment_totals as (
  select
    player_id,
    season_id,
    coalesce(sum(amount),0) total_paid_amount,
    coalesce(sum(sessions_covered),0) total_paid_sessions
  from public.payments
  group by player_id, season_id
),
usage as (
  select
    a.player_id,
    s.season_id,
    count(*) filter (
      where a.status in ('played','replacement')
        or (a.status = 'confirmed' and (s.status = 'completed' or s.session_date < (now() at time zone 'America/Toronto')::date))
    )::numeric total_played_sessions,
    coalesce(sum(
      case
        when a.status in ('played','replacement')
          or (a.status = 'confirmed' and (s.status = 'completed' or s.session_date < (now() at time zone 'America/Toronto')::date))
        then coalesce(spc.amount, s.price_per_session, seasons.price_per_session)
        when a.status in ('confirmed','played','replacement') and spc.id is not null
        then spc.amount
        else 0
      end
    ),0) estimated_used_amount,
    coalesce(sum(
      case
        when a.status in ('played','replacement')
          or (a.status = 'confirmed' and (s.status = 'completed' or s.session_date < (now() at time zone 'America/Toronto')::date))
          or (a.status = 'confirmed' and spc.id is not null)
        then coalesce(spc.waiver_amount, 0)
        else 0
      end
    ),0) waived_amount
  from public.attendance a
  join public.sessions s on s.id = a.session_id
  join public.seasons seasons on seasons.id = s.season_id
  left join public.session_player_charges spc on spc.session_id = a.session_id and spc.player_id = a.player_id
  group by a.player_id, s.season_id
),
refunds as (
  select
    player_id,
    season_id,
    coalesce(sum(amount) filter (where type = 'refund_due'),0) refund_due_amount
  from public.ledger_entries
  group by player_id, season_id
)
select
  p.id player_id,
  p.display_name player_name,
  s.id season_id,
  s.name season_name,
  coalesce(pt.total_paid_amount,0) total_paid_amount,
  coalesce(pt.total_paid_sessions,0) total_paid_sessions,
  coalesce(u.total_played_sessions,0) total_played_sessions,
  greatest(coalesce(pt.total_paid_sessions,0) - coalesce(u.total_played_sessions,0), 0) remaining_sessions,
  coalesce(u.estimated_used_amount,0) estimated_used_amount,
  greatest(coalesce(pt.total_paid_amount,0) - coalesce(u.estimated_used_amount,0), 0) credit_amount,
  coalesce(r.refund_due_amount,0) refund_due_amount,
  greatest(coalesce(u.estimated_used_amount,0) - coalesce(pt.total_paid_amount,0), 0) owes_money,
  coalesce(u.waived_amount,0) waived_amount
from public.players p
cross join public.seasons s
left join payment_totals pt on pt.player_id = p.id and pt.season_id = s.id
left join usage u on u.player_id = p.id and u.season_id = s.id
left join refunds r on r.player_id = p.id and r.season_id = s.id;
