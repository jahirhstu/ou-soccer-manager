-- Read-only diagnostics. Run in the production Supabase SQL Editor.
-- No financial records or season settings are changed.

-- 1. Confirm the imported season and inspect the original parser output.
select wi.id import_id, wi.status, wi.season_id, s.name season_name,
  wi.session_id, wi.created_at, wi.confirmed_at,
  wi.parsed_json ->> 'importType' import_type,
  wi.parsed_json -> 'players' parsed_players,
  wi.parsed_json -> 'payments' parsed_payments,
  wi.raw_text
from public.whatsapp_imports wi
left join public.seasons s on s.id = wi.season_id
where wi.id = 'debbe090-b907-472a-bb74-6718d5860a6f'::uuid;

-- 2. Preview each reviewed player UUID and their actual Fall balance.
-- Repeated rows in the parser JSON must not multiply the balance.
with roster as (
  select distinct player ->> 'matchedPlayerId' player_id,
    player ->> 'name' imported_name
  from public.whatsapp_imports wi
  cross join lateral jsonb_array_elements(coalesce(wi.parsed_json -> 'players', '[]'::jsonb)) player
  where wi.id = 'debbe090-b907-472a-bb74-6718d5860a6f'::uuid
)
select r.imported_name, r.player_id, p.display_name, p.status,
  ps.total_paid_amount, ps.estimated_used_amount, ps.credit_amount, ps.owes_money,
  ps.credit_amount - ps.owes_money balance_amount,
  exists (
    select 1 from public.public_player_report() report
    where report.player_id = p.id
      and report.season_id = '6c14cad3-7174-46e3-8598-3de6196e58b9'::uuid
  ) visible_in_public_report
from roster r
left join public.players p on p.id::text = r.player_id
left join public.player_season_payment_summary ps on ps.player_id = p.id
  and ps.season_id = '6c14cad3-7174-46e3-8598-3de6196e58b9'::uuid
order by r.imported_name;

-- 3. Show whether explicit player-line amounts were skipped at confirmation.
select al.created_at, al.action, al.entity_id, al.new_data
from public.audit_logs al
where al.new_data ->> 'import_id' = 'debbe090-b907-472a-bb74-6718d5860a6f'
order by al.created_at;

-- 4. Inspect every Fall payment for those UUIDs, including payments from other imports.
select pay.id payment_id, p.id player_id, p.display_name, pay.season_id,
  pay.session_id, pay.amount, pay.sessions_covered, pay.payment_date,
  pay.payment_method, pay.reference_note, pay.created_at
from public.payments pay
join public.players p on p.id = pay.player_id
where pay.season_id = '6c14cad3-7174-46e3-8598-3de6196e58b9'::uuid
  and exists (
    select 1 from public.whatsapp_imports wi
    cross join lateral jsonb_array_elements(coalesce(wi.parsed_json -> 'players', '[]'::jsonb)) player
    where wi.id = 'debbe090-b907-472a-bb74-6718d5860a6f'::uuid
      and player ->> 'matchedPlayerId' = pay.player_id::text
  )
order by p.display_name, pay.created_at;

-- 5. Check season configuration and the public report's automatic selection.
select s.id, s.name, s.status, s.start_date, s.end_date,
  s.price_per_session, s.total_planned_sessions, s.created_at,
  s.organization_id, s.program_id
from public.seasons s
join public.seasons fall on fall.id = '6c14cad3-7174-46e3-8598-3de6196e58b9'::uuid
where s.organization_id = fall.organization_id
  and s.program_id is not distinct from fall.program_id
order by s.start_date desc nulls last, s.created_at desc;

select report.*
from public.seasons fall
join public.organizations o on o.id = fall.organization_id
left join public.programs p on p.id = fall.program_id
cross join lateral public.public_report_season(o.slug, p.slug) report
where fall.id = '6c14cad3-7174-46e3-8598-3de6196e58b9'::uuid;
