-- Production data repair: split Rafi (original) from Rafiul (new player).
-- PostgreSQL / Supabase SQL Editor.
--
-- IMPORTANT:
--   1. Run the preview section first and review every result.
--   2. The repair transaction ends with ROLLBACK by default.
--   3. Only after the in-transaction validation is correct, change the final
--      ROLLBACK to COMMIT and run the transaction section again.
--
-- This script never identifies a row to be changed by player name. Names are
-- used only in the preview and in a fail-closed duplicate-name guard.

-- ---------------------------------------------------------------------------
-- Fixed identities
-- ---------------------------------------------------------------------------
-- Original Rafi: 4b9b53e5-c968-44af-a606-b505d8c9b13d
-- New Rafiul:     74f400d8-a9a4-40a0-ab97-47ca9e9448a4
-- Organization:   bc8032b0-1ce1-4f2c-93d1-df439a815274
-- Summer 2026:    3d3e9d51-1f97-4899-8046-89ecac4cd1b4
-- Sep 9 session:  625ae4e2-5c24-4cac-a11a-1b156492c18f
-- Sep 16 session: ae6a7f90-d395-41ef-9a7a-9037f1b5a2a1

-- ---------------------------------------------------------------------------
-- PREVIEW ONLY
-- ---------------------------------------------------------------------------

-- Player candidates and the account that must remain with original Rafi.
select p.id, p.display_name, p.phone, p.email, p.status, p.notes,
       p.organization_id, p.created_at, p.updated_at
from public.players p
where p.organization_id = 'bc8032b0-1ce1-4f2c-93d1-df439a815274'
  and (p.id = '4b9b53e5-c968-44af-a606-b505d8c9b13d'
       or lower(btrim(p.display_name)) in ('rafi', 'rafiul'))
order by p.created_at;

select pr.id, pr.display_name, pr.email, pr.player_id,
       om.id as organization_member_id, pm.id as program_member_id
from public.profiles pr
left join public.organization_members om on om.profile_id = pr.id
left join public.program_members pm on pm.profile_id = pr.id
where pr.id = '03bfb895-bd30-4e00-af11-aad4ae7bdfe5';

-- All ten attendance records. Only the two explicit September rows move.
select a.id as attendance_id, a.player_id, a.status,
       s.id as session_id, s.session_date, s.name, s.season_id,
       stp.id as team_player_id, st.id as session_team_id, st.name as team_name,
       spc.id as charge_id, spc.amount, spc.ledger_entry_id
from public.attendance a
join public.sessions s on s.id = a.session_id
left join public.session_team_players stp
  on stp.session_id = a.session_id and stp.player_id = a.player_id
left join public.session_teams st on st.id = stp.session_team_id
left join public.session_player_charges spc
  on spc.session_id = a.session_id and spc.player_id = a.player_id
where a.player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d'
order by s.session_date;

-- Exact goal rows that will be split by scorer/assist column.
select g.id, g.session_id, g.match_id, g.scorer_id, g.assist_player_id,
       g.goal_type, g.goal_count
from public.goals g
where g.id in (
  'd3298d29-9db4-42a9-8f41-84803212e657',
  'c16bf42f-9847-4fea-ae9a-266807fd3a92',
  '8a1afceb-3860-4140-a327-690c8fd2aa36',
  'c5bb7963-5e5c-448a-bb3c-707925967eb7',
  'eb96050b-4477-45f9-bd14-3fe044b41e0c',
  'a2fd0c6c-6145-493d-b3a3-e37fad464f19',
  'b6a0e8ba-863c-410a-8c6f-e2697ab291c6'
)
order by g.session_id, g.id;

-- Existing payments and ledger rows. The original $192 payment must remain.
select 'payment' as record_type, p.id, p.player_id, p.session_id,
       p.payment_date as record_date, p.amount, p.sessions_covered,
       p.payment_method, p.reference_note, p.created_at
from public.payments p
where p.player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d'
union all
select 'ledger', le.id, le.player_id, le.session_id,
       le.created_at::date, le.amount, le.sessions_count,
       le.type, le.description, le.created_at
from public.ledger_entries le
where le.player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d'
order by created_at;

-- Check session-scoped dependent records before changing anything.
select 'captain' as relation, st.id, st.session_id,
       st.captain_player_id as player_id
from public.session_teams st
where st.session_id in (
  '625ae4e2-5c24-4cac-a11a-1b156492c18f',
  'ae6a7f90-d395-41ef-9a7a-9037f1b5a2a1'
)
  and st.captain_player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d'
union all
select 'dropout_original', d.id, d.session_id, d.original_player_id
from public.dropouts d
where d.session_id in (
  '625ae4e2-5c24-4cac-a11a-1b156492c18f',
  'ae6a7f90-d395-41ef-9a7a-9037f1b5a2a1'
)
  and d.original_player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d'
union all
select 'dropout_replacement', d.id, d.session_id, d.replacement_player_id
from public.dropouts d
where d.session_id in (
  '625ae4e2-5c24-4cac-a11a-1b156492c18f',
  'ae6a7f90-d395-41ef-9a7a-9037f1b5a2a1'
)
  and d.replacement_player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d';

-- These three September imports contain no payment entries. Their parsed
-- player IDs will be corrected; raw_text remains immutable.
select wi.id, wi.session_id, wi.status, wi.created_at,
       wi.parsed_json -> 'payments' as parsed_payments,
       (length(wi.parsed_json::text)
        - length(replace(wi.parsed_json::text,
          '4b9b53e5-c968-44af-a606-b505d8c9b13d', ''))) / 36
          as old_player_id_occurrences
from public.whatsapp_imports wi
where wi.id in (
  'ec56dfd6-c6be-4f11-bd76-7618c05b330f',
  '11d38cf3-bc82-4def-bfa9-3b7e8b20a234',
  '1e97bf94-f801-40e0-88e7-065f5a289eab'
)
order by wi.created_at;

-- ---------------------------------------------------------------------------
-- REPAIR TRANSACTION
-- ---------------------------------------------------------------------------

begin;

-- Serialize this repair against concurrent edits to the affected players and
-- sessions, then reject any production state that differs from the preview.
select id from public.players
where id = '4b9b53e5-c968-44af-a606-b505d8c9b13d'
for update;

select id from public.sessions
where id in (
  '625ae4e2-5c24-4cac-a11a-1b156492c18f',
  'ae6a7f90-d395-41ef-9a7a-9037f1b5a2a1'
)
order by id
for update;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.players
  where id = '4b9b53e5-c968-44af-a606-b505d8c9b13d'
    and organization_id = 'bc8032b0-1ce1-4f2c-93d1-df439a815274';
  if v_count <> 1 then
    raise exception 'Original Rafi identity/organization check failed';
  end if;

  select count(*) into v_count
  from public.players
  where id = '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
     or (organization_id = 'bc8032b0-1ce1-4f2c-93d1-df439a815274'
         and lower(btrim(display_name)) = 'rafiul');
  if v_count <> 0 then
    raise exception 'New Rafiul ID or display name already exists; stop and reconcile it';
  end if;

  select count(*) into v_count
  from public.sessions
  where id in (
    '625ae4e2-5c24-4cac-a11a-1b156492c18f',
    'ae6a7f90-d395-41ef-9a7a-9037f1b5a2a1'
  )
    and season_id = '3d3e9d51-1f97-4899-8046-89ecac4cd1b4'
    and organization_id = 'bc8032b0-1ce1-4f2c-93d1-df439a815274';
  if v_count <> 2 then
    raise exception 'Expected both September sessions in Summer 2026';
  end if;

  select count(*) into v_count
  from public.attendance
  where id in (
    '4939cfa5-7c18-42ce-850b-fffc5b602559',
    '77e82f26-54ea-4b87-b1b2-4d303eaad3f8'
  )
    and player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d';
  if v_count <> 2 then
    raise exception 'Expected two September attendance rows owned by original UUID';
  end if;

  select count(*) into v_count
  from public.session_team_players
  where id in (
    'bf0e092b-689a-47de-9c10-c0c4940b0fe0',
    '3dfe32d5-e927-4e3f-8dfa-5f5e458ce7fa'
  )
    and player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d';
  if v_count <> 2 then
    raise exception 'Expected two September team-player rows owned by original UUID';
  end if;

  select count(*) into v_count
  from public.session_player_charges
  where id in (
    'e49dc6f5-c0ff-4bf0-82e0-24752fe47193',
    '22dfefa6-9e04-4efb-857c-531d846ada2b'
  )
    and player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d'
    and amount = 12.00;
  if v_count <> 2 then
    raise exception 'Expected two $12 September charge rows owned by original UUID';
  end if;

  select count(*) into v_count
  from public.ledger_entries
  where id in (
    '43656eb1-9778-4d3a-bdd2-218957eea00e',
    'd4a862e5-d3e1-468a-a705-fe970b8587a1'
  )
    and player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d'
    and type = 'session_used'
    and amount = 12.00;
  if v_count <> 2 then
    raise exception 'Expected two $12 September usage ledger rows';
  end if;

  select count(*) into v_count
  from public.payments
  where player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d'
    and id = '0efe9a11-77b8-45bd-8e0a-e0f43ecf6700'
    and amount = 192.00;
  if v_count <> 1 then
    raise exception 'Original Rafi $192 payment check failed';
  end if;

  select count(*) into v_count
  from public.profiles
  where id = '03bfb895-bd30-4e00-af11-aad4ae7bdfe5'
    and player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d';
  if v_count <> 1 then
    raise exception 'Original Rafi account link check failed';
  end if;

  select count(*) into v_count
  from public.whatsapp_imports
  where id in (
    'ec56dfd6-c6be-4f11-bd76-7618c05b330f',
    '11d38cf3-bc82-4def-bfa9-3b7e8b20a234',
    '1e97bf94-f801-40e0-88e7-065f5a289eab'
  )
    and parsed_json::text like '%4b9b53e5-c968-44af-a606-b505d8c9b13d%';
  if v_count <> 3 then
    raise exception 'Expected all three September imports to reference the merged UUID';
  end if;
end $$;

insert into public.players (
  id, display_name, phone, email, status, notes, organization_id
)
values (
  '74f400d8-a9a4-40a0-ab97-47ca9e9448a4',
  'Rafiul',
  null,
  null,
  'active',
  'Created by production repair after same-name WhatsApp import merge. Owns Sep 9 and Sep 16, 2026 sessions only.',
  'bc8032b0-1ce1-4f2c-93d1-df439a815274'
);

update public.attendance
set player_id = '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
where player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d'
  and id in (
    '4939cfa5-7c18-42ce-850b-fffc5b602559',
    '77e82f26-54ea-4b87-b1b2-4d303eaad3f8'
  );

update public.session_team_players
set player_id = '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
where player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d'
  and id in (
    'bf0e092b-689a-47de-9c10-c0c4940b0fe0',
    '3dfe32d5-e927-4e3f-8dfa-5f5e458ce7fa'
  );

update public.session_player_charges
set player_id = '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
where player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d'
  and id in (
    'e49dc6f5-c0ff-4bf0-82e0-24752fe47193',
    '22dfefa6-9e04-4efb-857c-531d846ada2b'
  );

update public.ledger_entries
set player_id = '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
where player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d'
  and id in (
    '43656eb1-9778-4d3a-bdd2-218957eea00e',
    'd4a862e5-d3e1-468a-a705-fe970b8587a1'
  );

-- Five goals scored by Rafiul.
update public.goals
set scorer_id = '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
where scorer_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d'
  and id in (
    'd3298d29-9db4-42a9-8f41-84803212e657',
    '8a1afceb-3860-4140-a327-690c8fd2aa36',
    'eb96050b-4477-45f9-bd14-3fe044b41e0c',
    'a2fd0c6c-6145-493d-b3a3-e37fad464f19',
    'b6a0e8ba-863c-410a-8c6f-e2697ab291c6'
  );

-- Two assists made by Rafiul.
update public.goals
set assist_player_id = '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
where assist_player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d'
  and id in (
    'c16bf42f-9847-4fea-ae9a-266807fd3a92',
    'c5bb7963-5e5c-448a-bb3c-707925967eb7'
  );

-- These are fail-closed, session-scoped updates. The preview is expected to
-- return no rows, but this keeps any discovered captain/dropout relationship
-- internally consistent without touching May-July data.
update public.session_teams
set captain_player_id = '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
where captain_player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d'
  and session_id in (
    '625ae4e2-5c24-4cac-a11a-1b156492c18f',
    'ae6a7f90-d395-41ef-9a7a-9037f1b5a2a1'
  );

update public.dropouts
set original_player_id = '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
where original_player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d'
  and session_id in (
    '625ae4e2-5c24-4cac-a11a-1b156492c18f',
    'ae6a7f90-d395-41ef-9a7a-9037f1b5a2a1'
  );

update public.dropouts
set replacement_player_id = '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
where replacement_player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d'
  and session_id in (
    '625ae4e2-5c24-4cac-a11a-1b156492c18f',
    'ae6a7f90-d395-41ef-9a7a-9037f1b5a2a1'
  );

-- Correct only the parsed references in the three September imports. Keeping
-- raw_text unchanged preserves the original import evidence.
update public.whatsapp_imports
set parsed_json = replace(
  parsed_json::text,
  '4b9b53e5-c968-44af-a606-b505d8c9b13d',
  '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
)::jsonb
where id in (
  'ec56dfd6-c6be-4f11-bd76-7618c05b330f',
  '11d38cf3-bc82-4def-bfa9-3b7e8b20a234',
  '1e97bf94-f801-40e0-88e7-065f5a289eab'
)
  and parsed_json::text like '%4b9b53e5-c968-44af-a606-b505d8c9b13d%';

-- Two confirmed $12 e-transfer payments, one on each session date. There was
-- no transaction/reference number, so reference_note records the repair only.
insert into public.payments (
  id, organization_id, program_id, season_id, session_id, player_id,
  payment_date, amount, sessions_covered, payment_method, reference_note
)
select
  '4398cafe-dc35-41b3-a66a-0bb9e773f0d2',
  s.organization_id, s.program_id, s.season_id, s.id,
  '74f400d8-a9a4-40a0-ab97-47ca9e9448a4',
  s.session_date, 12.00, 1.00, 'e-transfer',
  'Production player-split repair; no external reference supplied.'
from public.sessions s
where s.id = '625ae4e2-5c24-4cac-a11a-1b156492c18f';

insert into public.payments (
  id, organization_id, program_id, season_id, session_id, player_id,
  payment_date, amount, sessions_covered, payment_method, reference_note
)
select
  '523e01c6-662a-4307-a3c7-a9de6c73fdef',
  s.organization_id, s.program_id, s.season_id, s.id,
  '74f400d8-a9a4-40a0-ab97-47ca9e9448a4',
  s.session_date, 12.00, 1.00, 'e-transfer',
  'Production player-split repair; no external reference supplied.'
from public.sessions s
where s.id = 'ae6a7f90-d395-41ef-9a7a-9037f1b5a2a1';

insert into public.ledger_entries (
  id, organization_id, program_id, season_id, session_id, player_id,
  type, amount, sessions_count, description
)
select
  '47b9c566-de38-49b8-9976-8493ffe0b3f8',
  p.organization_id, p.program_id, p.season_id, p.session_id, p.player_id,
  'payment_received', p.amount, p.sessions_covered,
  'E-transfer payment added by production player-split repair. Payment ID: ' || p.id
from public.payments p
where p.id = '4398cafe-dc35-41b3-a66a-0bb9e773f0d2';

insert into public.ledger_entries (
  id, organization_id, program_id, season_id, session_id, player_id,
  type, amount, sessions_count, description
)
select
  '94660237-c7e8-4624-b264-40ba8e3d649a',
  p.organization_id, p.program_id, p.season_id, p.session_id, p.player_id,
  'payment_received', p.amount, p.sessions_covered,
  'E-transfer payment added by production player-split repair. Payment ID: ' || p.id
from public.payments p
where p.id = '523e01c6-662a-4307-a3c7-a9de6c73fdef';

insert into public.audit_logs (
  id, organization_id, actor_id, action, entity_type, entity_id,
  old_data, new_data
)
values (
  '9d64eef5-623d-4749-b02c-8fe955f34fa9',
  'bc8032b0-1ce1-4f2c-93d1-df439a815274',
  null,
  'repair_player_merge',
  'players',
  '74f400d8-a9a4-40a0-ab97-47ca9e9448a4',
  jsonb_build_object(
    'merged_player_id', '4b9b53e5-c968-44af-a606-b505d8c9b13d',
    'reason', 'Same-name WhatsApp import matched new Rafiul to original Rafi'
  ),
  jsonb_build_object(
    'original_player_id', '4b9b53e5-c968-44af-a606-b505d8c9b13d',
    'new_player_id', '74f400d8-a9a4-40a0-ab97-47ca9e9448a4',
    'new_display_name', 'Rafiul',
    'moved_session_ids', jsonb_build_array(
      '625ae4e2-5c24-4cac-a11a-1b156492c18f',
      'ae6a7f90-d395-41ef-9a7a-9037f1b5a2a1'
    ),
    'inserted_payment_ids', jsonb_build_array(
      '4398cafe-dc35-41b3-a66a-0bb9e773f0d2',
      '523e01c6-662a-4307-a3c7-a9de6c73fdef'
    )
  )
);

-- Fail if any required update silently missed its target.
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.attendance
  where player_id = '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
    and id in (
      '4939cfa5-7c18-42ce-850b-fffc5b602559',
      '77e82f26-54ea-4b87-b1b2-4d303eaad3f8'
    );
  if v_count <> 2 then raise exception 'Post-repair attendance count is %', v_count; end if;

  select count(*) into v_count
  from public.session_team_players
  where player_id = '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
    and id in (
      'bf0e092b-689a-47de-9c10-c0c4940b0fe0',
      '3dfe32d5-e927-4e3f-8dfa-5f5e458ce7fa'
    );
  if v_count <> 2 then raise exception 'Post-repair team-player count is %', v_count; end if;

  select count(*) into v_count
  from public.session_player_charges
  where player_id = '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
    and id in (
      'e49dc6f5-c0ff-4bf0-82e0-24752fe47193',
      '22dfefa6-9e04-4efb-857c-531d846ada2b'
    );
  if v_count <> 2 then raise exception 'Post-repair charge count is %', v_count; end if;

  select count(*) into v_count
  from public.ledger_entries
  where player_id = '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
    and id in (
      '43656eb1-9778-4d3a-bdd2-218957eea00e',
      'd4a862e5-d3e1-468a-a705-fe970b8587a1'
    );
  if v_count <> 2 then raise exception 'Post-repair usage-ledger count is %', v_count; end if;

  select count(*) into v_count
  from public.goals
  where scorer_id = '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
    and id in (
      'd3298d29-9db4-42a9-8f41-84803212e657',
      '8a1afceb-3860-4140-a327-690c8fd2aa36',
      'eb96050b-4477-45f9-bd14-3fe044b41e0c',
      'a2fd0c6c-6145-493d-b3a3-e37fad464f19',
      'b6a0e8ba-863c-410a-8c6f-e2697ab291c6'
    );
  if v_count <> 5 then raise exception 'Post-repair scorer count is %', v_count; end if;

  select count(*) into v_count
  from public.goals
  where assist_player_id = '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
    and id in (
      'c16bf42f-9847-4fea-ae9a-266807fd3a92',
      'c5bb7963-5e5c-448a-bb3c-707925967eb7'
    );
  if v_count <> 2 then raise exception 'Post-repair assist count is %', v_count; end if;

  select count(*) into v_count
  from public.payments
  where player_id = '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
    and id in (
      '4398cafe-dc35-41b3-a66a-0bb9e773f0d2',
      '523e01c6-662a-4307-a3c7-a9de6c73fdef'
    )
    and amount = 12.00;
  if v_count <> 2 then raise exception 'Post-repair payment count is %', v_count; end if;

  -- Original account and package payment must be untouched.
  select count(*) into v_count
  from public.profiles
  where id = '03bfb895-bd30-4e00-af11-aad4ae7bdfe5'
    and player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d';
  if v_count <> 1 then raise exception 'Original account was unexpectedly changed'; end if;

  select count(*) into v_count
  from public.payments
  where id = '0efe9a11-77b8-45bd-8e0a-e0f43ecf6700'
    and player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d'
    and amount = 192.00;
  if v_count <> 1 then raise exception 'Original $192 payment was unexpectedly changed'; end if;

  select count(*) into v_count
  from public.attendance
  where player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d';
  if v_count <> 8 then raise exception 'Original Rafi should retain exactly eight attendance rows, found %', v_count; end if;

  select count(*) into v_count
  from public.whatsapp_imports
  where id in (
    'ec56dfd6-c6be-4f11-bd76-7618c05b330f',
    '11d38cf3-bc82-4def-bfa9-3b7e8b20a234',
    '1e97bf94-f801-40e0-88e7-065f5a289eab'
  )
    and parsed_json::text like '%4b9b53e5-c968-44af-a606-b505d8c9b13d%';
  if v_count <> 0 then raise exception 'A September import still references original Rafi'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- IN-TRANSACTION VALIDATION
-- Expected: Rafi has eight May-Jul sessions and $96 credit; Rafiul has two
-- September sessions, $24 paid, $24 used, five goals, and two assists.
-- ---------------------------------------------------------------------------

select p.id, p.display_name, p.phone, p.email, p.status, p.notes,
       p.organization_id, p.created_at
from public.players p
where p.id in (
  '4b9b53e5-c968-44af-a606-b505d8c9b13d',
  '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
)
order by p.display_name;

select p.id as player_id, p.display_name, s.id as session_id,
       s.session_date, s.name, a.status, st.name as team_name,
       spc.amount as charged_amount
from public.players p
join public.attendance a on a.player_id = p.id
join public.sessions s on s.id = a.session_id
left join public.session_team_players stp
  on stp.session_id = s.id and stp.player_id = p.id
left join public.session_teams st on st.id = stp.session_team_id
left join public.session_player_charges spc
  on spc.session_id = s.id and spc.player_id = p.id
where p.id in (
  '4b9b53e5-c968-44af-a606-b505d8c9b13d',
  '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
)
order by p.display_name, s.session_date;

select p.id as player_id, p.display_name,
       count(*) filter (where g.scorer_id = p.id) as goal_rows,
       coalesce(sum(g.goal_count) filter (where g.scorer_id = p.id), 0) as goals,
       count(*) filter (where g.assist_player_id = p.id) as assist_rows
from public.players p
left join public.goals g
  on g.scorer_id = p.id or g.assist_player_id = p.id
where p.id in (
  '4b9b53e5-c968-44af-a606-b505d8c9b13d',
  '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
)
group by p.id, p.display_name
order by p.display_name;

select p.id as player_id, p.display_name, pay.id as payment_id,
       pay.session_id, pay.payment_date, pay.amount,
       pay.sessions_covered, pay.payment_method, pay.reference_note
from public.players p
left join public.payments pay on pay.player_id = p.id
where p.id in (
  '4b9b53e5-c968-44af-a606-b505d8c9b13d',
  '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
)
order by p.display_name, pay.payment_date;

select *
from public.player_season_payment_summary
where player_id in (
  '4b9b53e5-c968-44af-a606-b505d8c9b13d',
  '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
)
  and season_id = '3d3e9d51-1f97-4899-8046-89ecac4cd1b4'
order by player_name;

select pr.id, pr.display_name, pr.email, pr.player_id
from public.profiles pr
where pr.id = '03bfb895-bd30-4e00-af11-aad4ae7bdfe5';

-- SAFE FIRST RUN: keep this as ROLLBACK. After reviewing all validation rows,
-- replace only this line with COMMIT and rerun the transaction section.
rollback;

-- ---------------------------------------------------------------------------
-- ROLLBACK SCRIPT (use only after a committed repair)
-- ---------------------------------------------------------------------------
-- This reverses every mutation made above using exact generated/affected IDs.
-- Keep commented until rollback is intentionally required.
--
-- begin;
--
-- delete from public.audit_logs
-- where id = '9d64eef5-623d-4749-b02c-8fe955f34fa9';
--
-- delete from public.ledger_entries
-- where id in (
--   '47b9c566-de38-49b8-9976-8493ffe0b3f8',
--   '94660237-c7e8-4624-b264-40ba8e3d649a'
-- );
--
-- delete from public.payments
-- where id in (
--   '4398cafe-dc35-41b3-a66a-0bb9e773f0d2',
--   '523e01c6-662a-4307-a3c7-a9de6c73fdef'
-- );
--
-- update public.whatsapp_imports
-- set parsed_json = replace(
--   parsed_json::text,
--   '74f400d8-a9a4-40a0-ab97-47ca9e9448a4',
--   '4b9b53e5-c968-44af-a606-b505d8c9b13d'
-- )::jsonb
-- where id in (
--   'ec56dfd6-c6be-4f11-bd76-7618c05b330f',
--   '11d38cf3-bc82-4def-bfa9-3b7e8b20a234',
--   '1e97bf94-f801-40e0-88e7-065f5a289eab'
-- )
--   and parsed_json::text like '%74f400d8-a9a4-40a0-ab97-47ca9e9448a4%';
--
-- update public.goals
-- set assist_player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d'
-- where assist_player_id = '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
--   and id in (
--     'c16bf42f-9847-4fea-ae9a-266807fd3a92',
--     'c5bb7963-5e5c-448a-bb3c-707925967eb7'
--   );
--
-- update public.goals
-- set scorer_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d'
-- where scorer_id = '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
--   and id in (
--     'd3298d29-9db4-42a9-8f41-84803212e657',
--     '8a1afceb-3860-4140-a327-690c8fd2aa36',
--     'eb96050b-4477-45f9-bd14-3fe044b41e0c',
--     'a2fd0c6c-6145-493d-b3a3-e37fad464f19',
--     'b6a0e8ba-863c-410a-8c6f-e2697ab291c6'
--   );
--
-- update public.dropouts
-- set replacement_player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d'
-- where replacement_player_id = '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
--   and session_id in (
--     '625ae4e2-5c24-4cac-a11a-1b156492c18f',
--     'ae6a7f90-d395-41ef-9a7a-9037f1b5a2a1'
--   );
--
-- update public.dropouts
-- set original_player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d'
-- where original_player_id = '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
--   and session_id in (
--     '625ae4e2-5c24-4cac-a11a-1b156492c18f',
--     'ae6a7f90-d395-41ef-9a7a-9037f1b5a2a1'
--   );
--
-- update public.session_teams
-- set captain_player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d'
-- where captain_player_id = '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
--   and session_id in (
--     '625ae4e2-5c24-4cac-a11a-1b156492c18f',
--     'ae6a7f90-d395-41ef-9a7a-9037f1b5a2a1'
--   );
--
-- update public.ledger_entries
-- set player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d'
-- where player_id = '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
--   and id in (
--     '43656eb1-9778-4d3a-bdd2-218957eea00e',
--     'd4a862e5-d3e1-468a-a705-fe970b8587a1'
--   );
--
-- update public.session_player_charges
-- set player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d'
-- where player_id = '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
--   and id in (
--     'e49dc6f5-c0ff-4bf0-82e0-24752fe47193',
--     '22dfefa6-9e04-4efb-857c-531d846ada2b'
--   );
--
-- update public.session_team_players
-- set player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d'
-- where player_id = '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
--   and id in (
--     'bf0e092b-689a-47de-9c10-c0c4940b0fe0',
--     '3dfe32d5-e927-4e3f-8dfa-5f5e458ce7fa'
--   );
--
-- update public.attendance
-- set player_id = '4b9b53e5-c968-44af-a606-b505d8c9b13d'
-- where player_id = '74f400d8-a9a4-40a0-ab97-47ca9e9448a4'
--   and id in (
--     '4939cfa5-7c18-42ce-850b-fffc5b602559',
--     '77e82f26-54ea-4b87-b1b2-4d303eaad3f8'
--   );
--
-- delete from public.players
-- where id = '74f400d8-a9a4-40a0-ab97-47ca9e9448a4';
--
-- commit;
