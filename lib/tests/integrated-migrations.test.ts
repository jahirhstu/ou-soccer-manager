import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

let db: PGlite;
const files = readdirSync("supabase/migrations").filter(name => name.endsWith(".sql")).sort();
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const org = id(1), otherOrg = id(2), program = id(3), otherProgram = id(4), foreignProgram = id(5);
const manager = id(6), owner = id(7), player = id(8), guest = id(9), season = id(10), nextSeason = id(11), otherSeason = id(12);
beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions;
    create extension pgcrypto with schema extensions;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb, email_confirmed_at timestamptz, updated_at timestamptz);
    create table auth.identities(user_id uuid, provider text, provider_id text, identity_data jsonb, updated_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create function auth.role() returns text language sql stable as $$ select current_user::text; $$;
    create publication supabase_realtime;
    grant usage on schema public, auth to anon, authenticated;
    alter default privileges in schema public grant all on tables to authenticated, service_role;
    alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;
  `);
  for (const file of files) {
    try { await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8")); }
    catch (error) { throw new Error(`${file}: ${(error as Error).message}`); }
  }
  await db.exec(`
    insert into auth.users(id,email) values ('${manager}','manager@example.test'),('${owner}','owner@example.test');
    insert into organizations(id,name,slug,public_reports_enabled,onboarding_status) values
      ('${org}','Integration A','integration-a',true,'active'),('${otherOrg}','Integration B','integration-b',false,'active');
    insert into organization_members(organization_id,profile_id,role,status) values
      ('${org}','${manager}','player','active'),('${org}','${owner}','owner','active');
    insert into organization_settings(organization_id,public_balances_enabled,public_payments_enabled)
      values ('${org}',true,true) on conflict (organization_id) do update set public_balances_enabled=true,public_payments_enabled=true;
    insert into organization_enabled_programs(organization_id,program_template_id)
      select o.id,t.id from organizations o cross join program_templates t
      where o.id in ('${org}','${otherOrg}') and t.key='soccer';
    insert into programs(id,organization_id,name,slug,activity_type,program_template_id)
      select v.id::uuid,v.org::uuid,v.slug,v.slug,'soccer',t.id from
      (values ('${program}','${org}','soccer'),('${otherProgram}','${org}','other'),('${foreignProgram}','${otherOrg}','soccer')) v(id,org,slug)
      cross join program_templates t where t.key='soccer';
    select seed_program_modules('${program}'); select seed_program_modules('${otherProgram}'); select seed_program_modules('${foreignProgram}');
    insert into program_modules(organization_id,program_id,module_key,enabled) values
      ('${org}','${program}','public_reports',true),('${org}','${otherProgram}','public_reports',true)
      on conflict(program_id,module_key) do update set enabled=true;
    insert into program_members(organization_id,program_id,profile_id,role,status) values ('${org}','${program}','${manager}','manager','active');
    insert into players(id,organization_id,display_name,status) values ('${player}','${org}','Funding','inactive'),('${guest}','${org}','Guest','active');
    insert into seasons(id,organization_id,program_id,name,start_date,status,price_per_session) values
      ('${season}','${org}','${program}','Summer','2020-05-01','active',12),
      ('${nextSeason}','${org}','${program}','Fall','2020-09-01','draft',12),
      ('${otherSeason}','${org}','${otherProgram}','Other','2020-09-01','active',12);
    insert into payments(organization_id,program_id,season_id,player_id,amount) values
      ('${org}','${program}','${season}','${player}',100),('${org}','${otherProgram}','${otherSeason}','${player}',200);
  `);
}, 60000);
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db?.close(); });
async function asUser(user: string) {
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
  await db.exec("set local role authenticated");
}

describe("integrated migration chain", () => {
  it("uses unique migration versions and installs both architectures and features", async () => {
    expect(new Set(files.map(name => name.split("_")[0])).size).toBe(files.length);
    const result = await db.query<{ name: string }>(`select proname name from pg_proc where proname in
      ('create_organization_onboarding','transfer_player_credit','record_player_refund','record_club_balance_transfer','scoped_public_longest_winning_streaks','scoped_public_session_performance')`);
    expect(result.rows).toHaveLength(6);
  });
  it("limits the session performance RPC to public report readers", async () => {
    for (const role of ["anon", "authenticated"]) {
      const result = await db.query<{ allowed: boolean }>(
        "select has_function_privilege($1,'public.scoped_public_session_performance(text,text,uuid)','execute') allowed",
        [role]
      );
      expect(result.rows[0].allowed).toBe(true);
    }
    const definition = await db.query<{ source: string }>(
      "select pg_get_functiondef('public.scoped_public_session_performance(text,text,uuid)'::regprocedure) source"
    );
    expect(definition.rows[0].source).toContain("resolve_enabled_public_scope");
    expect(definition.rows[0].source).toContain("is_program_module_enabled");
  });
  it("preserves compatible legacy votes and archives unaudited positions during reconciliation", async () => {
    const session = id(35), teamA = id(36), teamB = id(37), match = id(38);
    await db.query("insert into sessions(id,organization_id,program_id,season_id,name,session_date,status) values ($1,$2,$3,$4,'Legacy performance','2020-06-03','completed')",
      [session,org,program,season]);
    await db.query("insert into session_teams(id,session_id,name) values ($1,$3,'A'),($2,$3,'B')",
      [teamA,teamB,session]);
    await db.query("insert into session_team_players(session_id,session_team_id,player_id) values ($1,$2,$3)",
      [session,teamA,player]);
    await db.query("insert into session_matches(id,session_id,match_number,team_a_id,team_b_id) values ($1,$2,1,$3,$4)",
      [match,session,teamA,teamB]);
    await db.exec(`
      create table performance_votes(
        session_id uuid not null, team_id uuid not null, category text not null,
        player_id uuid not null, voter_id uuid not null, updated_at timestamptz not null
      );
      create table performance_voting(session_id uuid not null, closed boolean not null);
      create table performance_audit(
        id bigint primary key, session_id uuid not null, actor_id uuid not null,
        action text not null, payload jsonb not null, created_at timestamptz not null
      );
    `);
    const votedAt = "2020-06-03T12:00:00Z";
    await db.query("insert into performance_votes values ($1,$2,'defender',$3,$4,$5)",
      [session,teamA,player,manager,votedAt]);
    await db.query("insert into performance_voting values ($1,true)",[session]);
    await db.query("insert into performance_audit values (1,$1,$2,'voting_status','{\"closed\":true}',$3)",
      [session,manager,votedAt]);
    await db.query(
      "insert into match_player_positions(match_id,player_id,session_team_id,position,confirmed_by) values ($1,$2,$3,'midfielder',$4)",
      [match,player,teamA,manager]
    );

    await db.exec(readFileSync("supabase/migrations/103_reconcile_performance_migrations.sql","utf8"));

    const copiedVote = await db.query<{ player_id: string; voter_id: string }>(
      "select player_id,voter_id from captain_performance_votes where session_id=$1 and captain_team_id=$2 and category='defender'",
      [session,teamA]
    );
    expect(copiedVote.rows).toEqual([{player_id:player,voter_id:manager}]);
    const closeState = await db.query<{ closed: boolean; updated_by: string }>(
      "select closed,updated_by from session_performance_voting where session_id=$1",[session]
    );
    expect(closeState.rows).toEqual([{closed:true,updated_by:manager}]);
    const archivedPosition = await db.query<{ position: string; confirmed_by: string }>(
      "select position,confirmed_by from match_player_positions_legacy_archive where match_id=$1 and player_id=$2",
      [match,player]
    );
    expect(archivedPosition.rows).toEqual([{position:"midfielder",confirmed_by:manager}]);
    expect((await db.query("select 1 from match_player_positions where match_id=$1 and player_id=$2",[match,player])).rows)
      .toHaveLength(0);
    expect((await db.query("select 1 from performance_votes where session_id=$1",[session])).rows).toHaveLength(1);
    expect((await db.query("select 1 from performance_voting where session_id=$1",[session])).rows).toHaveLength(1);
    expect((await db.query("select 1 from performance_audit where session_id=$1",[session])).rows).toHaveLength(1);
  });
  it("does not reopen unscoped reports to anonymous or authenticated clients", async () => {
    for (const signature of ["public_player_report()", "public_sessions()", "public_longest_winning_streaks(uuid)", "public_latest_winning_streaks(uuid)", "public_payment_notification_keys()", "submit_payment_sent_notification(uuid,uuid)"]) {
      for (const role of ["anon", "authenticated"]) {
        const result = await db.query<{ allowed: boolean }>("select has_function_privilege($1,$2,'execute') allowed", [role, signature]);
        expect(result.rows[0].allowed, `${role}: ${signature}`).toBe(false);
      }
    }
  });
  it("lets a program manager refund inactive players and transfer credit without crossing programs", async () => {
    await asUser(manager);
    await db.query("select record_player_refund($1,$2,12,'2020-06-01','cash',null,$3)", [player,season,id(20)]);
    await db.query("select transfer_player_credit($1,$2,$3,13,'2020-06-01',null,null,$4)", [player,guest,season,id(21)]);
    const balance = await db.query<{ credit_amount: string }>("select credit_amount from player_season_payment_summary where player_id=$1 and season_id=$2",[player,season]);
    expect(balance.rows[0].credit_amount).toBe("75.00");
    const inaccessible = await db.query("select * from payments where season_id=$1",[otherSeason]);
    expect(inaccessible.rows).toHaveLength(0);
  });
  it("rejects another program even inside the same organization", async () => {
    await asUser(manager);
    await expect(db.query("select record_player_refund($1,$2,12,'2020-06-01','cash',null,$3)",[player,otherSeason,id(22)])).rejects.toThrow("authorized program manager");
  });
  it("carries player credit and reverses a club surplus under program-manager authority", async () => {
    await asUser(manager);
    await db.query("select carry_forward_player_balance($1,$2,$3,20,'2020-06-01',null,$4,'credit')",[player,season,nextSeason,id(24)]);
    await db.query("insert into club_expenses(season_id,category,amount) values ($1,'other',10)",[season]);
    const result = await db.query<{ id: string }>("select record_club_balance_transfer($1,$2,10,'2020-06-01',null,$3) id",[season,nextSeason,id(25)]);
    // Credit moved separately: source cash 100 - expense 10 - remaining player credit 80 = 10.
    expect((await db.query<{ net_club_balance: string }>("select net_club_balance from admin_dashboard_season_finance($1)",[season])).rows[0].net_club_balance).toBe("0.00");
    await db.query("select reverse_club_balance_transfer($1,$2)",[result.rows[0].id,id(26)]);
    expect((await db.query<{ net_club_balance: string }>("select net_club_balance from admin_dashboard_season_finance($1)",[season])).rows[0].net_club_balance).toBe("10.00");
  });
  it("derives imported rows from the chosen season and rejects mismatched program IDs", async () => {
    await asUser(manager);
    const result = await db.query<{ organization_id: string; program_id: string }>("insert into whatsapp_imports(season_id,raw_text,parsed_json,status) values ($1,'Signup','{}','confirmed') returning organization_id,program_id",[season]);
    expect(result.rows[0]).toEqual({ organization_id: org, program_id: program });
    await expect(db.query("insert into payments(season_id,player_id,program_id,amount) values ($1,$2,$3,12)",[season,player,otherProgram])).rejects.toThrow("Program must match");
  });
  it("rejects disabled payments for organization owners too", async () => {
    await db.query("update program_modules set enabled=false where program_id=$1 and module_key='payments'",[program]);
    await asUser(owner);
    await expect(db.query("select record_player_refund($1,$2,12,'2020-06-01','cash',null,$3)",[player,season,id(23)])).rejects.toThrow("authorized program manager");
  });
  it("rejects suspended organization membership despite an active program-manager row", async () => {
    await db.query("update organization_members set status='suspended' where profile_id=$1",[manager]);
    await asUser(manager);
    await expect(db.query("select admin_dashboard_season_finance($1)",[season])).rejects.toThrow("authorized program manager");
  });
  it("persists guided draft categories per session and exposes profile positions to the website builder", async () => {
    const session = id(60);
    await db.query("insert into sessions(id,organization_id,program_id,season_id,name,session_date,status) values ($1,$2,$3,$4,'Guided draft','2020-06-03','scheduled')",
      [session,org,program,season]);
    await db.query("update players set preferred_position='forward' where id=$1",[player]);
    await db.query("insert into attendance(organization_id,program_id,session_id,player_id,status) values ($1,$2,$3,$4,'confirmed'),($1,$2,$3,$5,'confirmed')",
      [org,program,session,player,guest]);
    await asUser(manager);
    await db.query(
      "select save_program_team_builder_guided_draft($1,'[]'::jsonb,7,0,'[]'::jsonb,0,$2::jsonb)",
      [session,JSON.stringify({ [player]: "goalkeeper", [guest]: "unassigned" })]
    );
    const saved = await db.query<{ draft_mode: string; draft_position_categories: Record<string, string> }>(
      "select draft_mode,draft_position_categories from session_team_builder_drafts where session_id=$1",
      [session]
    );
    expect(saved.rows[0]).toEqual({
      draft_mode: "guided",
      draft_position_categories: { [player]: "goalkeeper", [guest]: "unassigned" }
    });
    const publicData = await db.query<{ data: { players: Array<{ id: string; preferredPosition: string | null }>; draft: { draftMode: string; draftPositionCategories: Record<string, string> } } }>(
      "select scoped_public_session_team_builder('integration-a','soccer',$1) data",
      [session]
    );
    expect(publicData.rows[0].data.draft).toMatchObject({
      draftMode: "guided",
      draftPositionCategories: { [player]: "goalkeeper", [guest]: "unassigned" }
    });
    expect(publicData.rows[0].data.players.find((row) => row.id === player)?.preferredPosition).toBe("forward");
  });
  it("excludes read payment alerts but keeps unread alerts in the public scope", async () => {
    await db.query(`insert into notifications(organization_id,player_id,season_id,amount,message,read_at)
      values ($1,$2,$3,13,'Accepted payment',now()),($1,$2,$3,13,'Pending payment',null),
      ($1,$2,$4,13,'Other program',null)`, [org,player,season,otherSeason]);
    await db.exec("set local role anon");
    const pending = await db.query("select * from scoped_public_payment_notification_keys('integration-a','soccer')");
    expect(pending.rows).toEqual([{ player_id: player, season_id: season, amount: '13.00' }]);
    await db.exec("reset role");
    await db.query("update notifications set read_at=now() where player_id=$1", [player]);
    await db.exec("set local role anon");
    expect((await db.query("select * from scoped_public_payment_notification_keys('integration-a','soccer')")).rows).toEqual([]);
  });
  it("keeps public season lookup and notification amounts behind the public scope", async () => {
    await db.query("update program_modules set enabled=false where program_id=$1 and module_key='public_reports'",[program]);
    await db.exec("set local role anon");
    expect((await db.query("select * from public_report_season('integration-a','soccer')")).rows).toHaveLength(0);
    expect((await db.query("select * from scoped_public_payment_notification_keys('integration-b','soccer')")).rows).toHaveLength(0);
    const scope = await db.query<{ program_id: string }>("select * from resolve_enabled_public_scope('integration-a',null)");
    expect(scope.rows.map(row => row.program_id)).toEqual([otherProgram]);
  });
  it("uses scoring events before lineup and profile positions and ignores manual match overrides", async () => {
    const session = id(31), teamA = id(32), teamB = id(33), match = id(34);
    await db.query("update players set preferred_position='forward' where id=$1",[player]);
    await db.query("insert into sessions(id,organization_id,program_id,season_id,name,session_date) values ($1,$2,$3,$4,'Position priority','2020-06-02')",
      [session,org,program,season]);
    await db.query("insert into session_teams(id,session_id,name) values ($1,$3,'A'),($2,$3,'B')",[teamA,teamB,session]);
    await db.query("insert into session_team_players(session_id,session_team_id,player_id) values ($1,$2,$3),($1,$4,$5)",
      [session,teamA,player,teamB,guest]);
    await db.query("insert into players(id,organization_id,display_name,status) values ($1,$2,'Rotating Keeper','active')",
      [id(35),org]);
    await db.query("insert into session_team_players(session_id,session_team_id,player_id) values ($1,$2,$3)",
      [session,teamB,id(35)]);
    await db.query("insert into session_team_lineups(session_id,session_team_id,organization_id,player_count,positions) values ($1,$2,$3,1,$4)",
      [session,teamA,org,JSON.stringify([{playerId:player,position:"defender"}])]);
    await db.query("insert into session_matches(id,session_id,match_number,team_a_id,team_b_id) values ($1,$2,1,$3,$4)",
      [match,session,teamA,teamB]);
    await db.query("update session_matches set result_status='played',team_a_score=1,team_b_score=0 where id=$1",[match]);
    const ratedPositions = async () => (await db.query<{ positions: string[] | null }>(
      "select positions from match_performance_detail where match_id=$1 and player_id=$2",[match,player]
    )).rows[0].positions;
    expect(await ratedPositions()).toEqual(["defender"]);
    await db.query("insert into match_score_positions(match_id,player_id,position) values ($1,$2,'midfielder')",[match,player]);
    await db.query("insert into match_player_positions(match_id,player_id,session_team_id,position,confirmed_by) values ($1,$2,$3,'goalkeeper',$4)",
      [match,player,teamA,manager]);
    expect(await ratedPositions()).toEqual(["defender"]);
    await db.query("insert into match_player_positions(match_id,player_id,session_team_id,position,confirmed_by) values ($1,$2,$3,'goalkeeper',$4)",
      [match,guest,teamB,manager]);
    expect(await ratedPositions()).toEqual(["defender"]);
    await db.query("delete from match_player_positions where match_id=$1",[match]);
    await db.query("delete from match_score_positions where match_id=$1 and player_id=$2",[match,player]);
    await db.query("delete from session_team_lineups where session_team_id=$1",[teamA]);
    expect(await ratedPositions()).toEqual(["forward"]);

    await db.query("insert into goals(session_id,match_id,scorer_id,session_team_id,goal_type,goal_count,player_position,conceded_goalkeeper_id) values ($1,$2,$3,$4,'goal',1,'midfielder',$5),($1,$2,$3,$4,'goal',1,'forward',$6)",
      [session,match,player,teamA,guest,id(35)]);
    await db.query("update session_matches set team_a_score=2 where id=$1",[match]);
    const rating = await db.query<{ positions: string[]; keeper_conceded: number; rating: string }>(
      "select positions,keeper_conceded,breakdown->>'rating' rating from match_performance_detail where match_id=$1 and player_id=$2",
      [match,player]
    );
    expect(rating.rows[0].positions).toEqual(["forward","midfielder"]);
    expect(Number(rating.rows[0].rating)).toBeCloseTo(7.5, 2);

    const keepers = await db.query<{ player_id: string; keeper_conceded: number; positions: string[] }>(
      "select player_id,keeper_conceded,positions from match_performance_detail where match_id=$1 and player_id in ($2,$3) order by player_id",
      [match,guest,id(35)]
    );
    expect(keepers.rows.map(row => [row.keeper_conceded,row.positions])).toEqual([
      [1,["goalkeeper"]],[1,["goalkeeper"]]
    ]);

    const positionCalculation = await db.query<{ rating: string }>(
      "select public.match_performance_points_v2(array['goalkeeper','forward'],3,2,1,0,1,false)->>'rating' rating"
    );
    expect(Number(positionCalculation.rows[0].rating)).toBeCloseTo(7.7917, 3);
    const provisional = await db.query<{ provisional: boolean }>(
      "select (public.match_performance_points_v2(array['goalkeeper'],3,2,0,0,0,true)->>'provisional')::boolean provisional"
    );
    expect(provisional.rows[0].provisional).toBe(true);

    const incompleteKeeper = await db.query<{ keeper_attribution_incomplete: boolean; breakdown: { provisional: boolean } }>(
      "select keeper_attribution_incomplete,breakdown from match_performance_detail where match_id=$1 and player_id=$2",
      [match,guest]
    );
    expect(incompleteKeeper.rows[0]).toMatchObject({ keeper_attribution_incomplete: false, breakdown: { provisional: false } });

    await asUser(manager);
    const performance = await db.query<{
      data: { results: { player_id: string; positions: string[] }[] };
    }>("select session_performance($1) data", [session]);
    expect(performance.rows[0].data.results.find((item: any) => item.player_id === player)?.positions)
      .toEqual(["forward","midfielder"]);
  });

  it("calculates single-position points and 40-point session normalization from actual match counts", async () => {
    const session = id(41), teamA = id(42), teamB = id(43), teamC = id(46), match1 = id(44), match2 = id(45), match3 = id(47);
    await db.query("insert into sessions(id,organization_id,program_id,season_id,name,session_date,status) values ($1,$2,$3,$4,'Rating calculation','2020-06-02','completed')",
      [session,org,program,season]);
    await db.query("insert into players(id,organization_id,display_name,status,preferred_position) values ($1,$2,'Single-match player','active','midfielder')",
      [id(48),org]);
    await db.query("insert into players(id,organization_id,display_name,status,preferred_position) values ($1,$2,'Assist player','active','midfielder')",
      [id(49),org]);
    await db.query("insert into session_teams(id,session_id,name) values ($1,$4,'A'),($2,$4,'B'),($3,$4,'C')",[teamA,teamB,teamC,session]);
    await db.query("insert into session_team_players(session_id,session_team_id,player_id) values ($1,$2,$3),($1,$4,$5),($1,$6,$7),($1,$2,$8)",
      [session,teamA,player,teamB,guest,teamC,id(48),id(49)]);
    await db.query("insert into session_matches(id,session_id,match_number,team_a_id,team_b_id,result_status,team_a_score,team_b_score) values ($1,$4,1,$5,$6,'played',3,2),($2,$4,2,$5,$6,'played',0,0),($3,$4,3,$7,$6,'played',1,0)",
      [match1,match2,match3,session,teamA,teamB,teamC]);
    await db.query("update players set preferred_position='forward' where id=$1",[player]);
    await db.query("update players set preferred_position='goalkeeper' where id=$1",[guest]);
    await db.query("insert into goals(session_id,match_id,scorer_id,assist_player_id,session_team_id,goal_type,goal_count,player_position) values ($1,$2,$3,$4,$5,'goal',1,'forward')",
      [session,match1,player,id(49),teamA]);
    const single = await db.query<{ rating: string; position: string }>(
      "select breakdown->>'rating' rating,position from match_performance_detail where match_id=$1 and player_id=$2",
      [match1,player]
    );
    expect(single.rows[0].position).toBe("forward");
    expect(Number(single.rows[0].rating)).toBeCloseTo(7.25, 2);
    const sessionResult = await db.query<{ matches_played: number; match_points: string }>(
      "select matches_played,match_points from session_performance_results where session_id=$1 and player_id=$2",
      [session,player]
    );
    expect(sessionResult.rows[0].matches_played).toBe(2);
    expect(Number(sessionResult.rows[0].match_points)).toBeCloseTo(16.5, 2);
    const oneMatch = await db.query<{ matches_played: number }>(
      "select matches_played from session_performance_results where session_id=$1 and player_id=$2",
      [session,id(48)]
    );
    expect(oneMatch.rows[0].matches_played).toBe(1);
    const keeperCleanSheet = await db.query<{ clean_sheet: boolean }>(
      "select clean_sheet from match_performance_detail where match_id=$1 and player_id=$2",
      [match2,guest]
    );
    expect(keeperCleanSheet.rows[0].clean_sheet).toBe(false);
  });

  it("opens member nominations on any played fixture and locks them on close or completion", async () => {
    const member = id(70), session = id(71), teamA = id(72), teamB = id(73);
    const playedMatch = id(74), scheduledMatch = id(75), authorizedMember = id(76), authorizedPlayer = id(77);
    await db.query("insert into auth.users(id,email) values ($1,'participant@example.test')", [member]);
    await db.query("insert into auth.users(id,email) values ($1,'authorized@example.test')", [authorizedMember]);
    await db.query(
      "insert into organization_members(organization_id,profile_id,role,player_id,status) values ($1,$2,'player',$3,'active')",
      [org,member,guest]
    );
    await db.query(
      "insert into program_members(organization_id,program_id,profile_id,player_id,role,status) values ($1,$2,$3,null,'member','active')",
      [org,program,member]
    );
    await db.query(
      "insert into players(id,organization_id,display_name,status,preferred_position) values ($1,$2,'Authorized nonparticipant','active','defender')",
      [authorizedPlayer,org]
    );
    await db.query(
      "insert into organization_members(organization_id,profile_id,role,player_id,status) values ($1,$2,'player',$3,'active')",
      [org,authorizedMember,authorizedPlayer]
    );
    await db.query(
      "insert into program_members(organization_id,program_id,profile_id,player_id,role,status) values ($1,$2,$3,null,'member','active')",
      [org,program,authorizedMember]
    );
    await db.query("update program_modules set enabled=true where program_id=$1 and module_key='scores'",[program]);
    await db.query("update players set preferred_position='defender' where id=any($1::uuid[])",[[player,guest]]);
    await db.query(
      "insert into sessions(id,organization_id,program_id,season_id,name,session_date,status) values ($1,$2,$3,$4,'Played fixture nominations','2020-06-03','scheduled')",
      [session,org,program,season]
    );
    await db.query("insert into session_teams(id,session_id,name) values ($1,$3,'A'),($2,$3,'B')",[teamA,teamB,session]);
    await db.query(
      "insert into session_team_players(session_id,session_team_id,player_id) values ($1,$2,$3),($1,$2,$4)",
      [session,teamA,guest,player]
    );

    await asUser(member);
    let response = (await db.query<{ data: { canNominate: boolean; nominations?: { category: string; player_id: string }[] } }>(
      "select session_performance($1) data",[session]
    )).rows[0].data;
    expect(response.canNominate).toBe(false);

    await db.exec("reset role");
    await db.query(
      "insert into session_matches(id,session_id,match_number,team_a_id,team_b_id,result_status) values ($1,$3,1,$4,$5,'scheduled'),($2,$3,2,$4,$5,'scheduled')",
      [playedMatch,scheduledMatch,session,teamA,teamB]
    );
    await asUser(member);
    response = (await db.query<{ data: { canNominate: boolean; nominations?: { category: string; player_id: string }[] } }>(
      "select session_performance($1) data",[session]
    )).rows[0].data;
    expect(response.canNominate).toBe(false);

    await db.exec("reset role");
    await db.query("update session_matches set result_status='played',team_a_score=0,team_b_score=0 where id=$1",[playedMatch]);
    await asUser(member);
    response = (await db.query<{ data: { canNominate: boolean; nominations?: { category: string; player_id: string }[] } }>(
      "select session_performance($1) data",[session]
    )).rows[0].data;
    expect(response.canNominate).toBe(true);

    await db.exec("reset role");
    await asUser(authorizedMember);
    await db.exec("savepoint unauthorized_nonparticipant_nomination");
    await expect(db.query(
      "select submit_session_performance_nomination($1,'defender',$2)",[session,player]
    )).rejects.toThrow("not authorized");
    await db.exec("rollback to savepoint unauthorized_nonparticipant_nomination");
    await db.exec("reset role");
    await asUser(manager);
    await db.query("select authorize_session_performance_nominator($1,$2,true)",[session,authorizedPlayer]);
    await db.exec("reset role");
    await asUser(authorizedMember);
    await db.query("select submit_session_performance_nomination($1,'defender',$2)",[session,player]);
    await db.exec("reset role");
    await asUser(member);
    await db.query("select submit_session_performance_nomination($1,'goalkeeper',$2)",[session,player]);
    response = (await db.query<{ data: { canNominate: boolean; nominations?: { category: string; player_id: string }[] } }>(
      "select session_performance($1) data",[session]
    )).rows[0].data;
    expect(response.nominations ?? []).toContainEqual({ category: "goalkeeper", player_id: player });
    await db.exec("reset role");
    const positionIndependentVote = await db.query<{ count: string }>(
      "select count(*)::text count from valid_session_performance_nominations where session_id=$1 and category='goalkeeper' and player_id=$2",
      [session,player]
    );
    expect(Number(positionIndependentVote.rows[0].count)).toBe(1);
    const positionIndependentPoints = await db.query<{ nomination_points: string }>(
      "select nomination_points from session_player_nomination_points where session_id=$1 and player_id=$2",
      [session,player]
    );
    expect(Number(positionIndependentPoints.rows[0].nomination_points)).toBe(40);
    await asUser(member);
    await db.exec("savepoint duplicate_member_nomination");
    await expect(db.query(
      "select submit_session_performance_nomination($1,'goalkeeper',$2)",[session,player]
    )).rejects.toThrow("already nominated");
    await db.exec("rollback to savepoint duplicate_member_nomination");
    await db.exec("savepoint duplicate_member_player_category");
    await expect(db.query(
      "select submit_session_performance_nomination($1,'midfielder',$2)",[session,player]
    )).rejects.toThrow("another category");
    await db.exec("rollback to savepoint duplicate_member_player_category");
    await db.exec("savepoint member_self_nomination");
    await expect(db.query(
      "select submit_session_performance_nomination($1,'goalkeeper',$2)",[session,guest]
    )).rejects.toThrow("cannot nominate yourself");
    await db.exec("rollback to savepoint member_self_nomination");

    await db.exec("reset role");
    await asUser(manager);
    await db.query("select close_performance_voting($1,true)",[session]);
    await db.exec("reset role");
    await asUser(member);
    response = (await db.query<{ data: { canNominate: boolean; nominations?: { category: string; player_id: string }[] } }>(
      "select session_performance($1) data",[session]
    )).rows[0].data;
    expect(response.canNominate).toBe(false);
    expect(response.nominations ?? []).toContainEqual({ category: "goalkeeper", player_id: player });
    await db.exec("savepoint closed_session_nomination");
    await expect(db.query(
      "select submit_session_performance_nomination($1,'midfielder',$2)",[session,player]
    )).rejects.toThrow("Nominations are closed");
    await db.exec("rollback to savepoint closed_session_nomination");

    await db.exec("reset role");
    await asUser(manager);
    await db.query("select close_performance_voting($1,false)",[session]);
    await db.exec("reset role");
    await db.query("update sessions set status='completed' where id=$1",[session]);
    await asUser(member);
    response = (await db.query<{ data: { canNominate: boolean; nominations?: { category: string; player_id: string }[] } }>(
      "select session_performance($1) data",[session]
    )).rows[0].data;
    expect(response.canNominate).toBe(false);
    expect(response.nominations ?? []).toContainEqual({ category: "goalkeeper", player_id: player });
    await db.exec("savepoint completed_session_nomination");
    await expect(db.query(
      "select submit_session_performance_nomination($1,'midfielder',$2)",[session,player]
    )).rejects.toThrow("Completed sessions are read-only");
    await db.exec("rollback to savepoint completed_session_nomination");
    await db.exec("reset role");
    await asUser(manager);
    await db.exec("savepoint completed_voting_reopen");
    await expect(db.query("select close_performance_voting($1,false)",[session]))
      .rejects.toThrow("Completed sessions are read-only");
    await db.exec("rollback to savepoint completed_voting_reopen");
  });

  it("caps nomination points at 20 per valid vote and 60 per category", async () => {
    const session = id(51), teamA = id(52), teamB = id(53), teamC = id(54), teamD = id(55), match = id(56), nomineeTeam = id(57);
    await db.query("insert into sessions(id,organization_id,program_id,season_id,name,session_date,status) values ($1,$2,$3,$4,'Nomination points','2020-06-02','completed')",
      [session,org,program,season]);
    await db.query("insert into session_teams(id,session_id,name,captain_player_id) values ($1,$6,'A',$7),($2,$6,'B',$7),($3,$6,'C',$7),($4,$6,'D',$7),($5,$6,'Nominee',null)",
      [teamA,teamB,teamC,teamD,nomineeTeam,session,player]);
    await db.query("insert into session_team_players(session_id,session_team_id,player_id) values ($1,$2,$3),($1,$4,$5)",
      [session,teamA,player,nomineeTeam,guest]);
    await db.query("update program_members set player_id=$1 where program_id=$2 and profile_id=$3",[player,program,manager]);
    await db.query("update players set preferred_position='defender' where id=any($1::uuid[])",[[player,guest]]);
    await db.query("insert into session_matches(id,session_id,match_number,team_a_id,team_b_id,result_status) values ($1,$2,1,$3,$4,'played')",
      [match,session,teamA,nomineeTeam]);
    await db.query("insert into goals(session_id,match_id,scorer_id,session_team_id,goal_type,goal_count,player_position,conceded_goalkeeper_id) values ($1,$2,$3,$4,'goal',1,'midfielder',$5),($1,$2,$5,$6,'goal',1,'defender',$3)",
      [session,match,player,teamA,guest,nomineeTeam]);
    await db.query("update session_matches set team_a_score=1,team_b_score=1 where id=$1",[match]);
    await db.query("insert into captain_performance_votes(session_id,captain_team_id,category,player_id,voter_id) select $1,id,'defender',$2,$3 from session_teams where id=any($4::uuid[])",
      [session,guest,manager,[teamA,teamB,teamC,teamD]]);
    const nomineePositions = await db.query<{ positions: string[] }>(
      "select positions from match_performance_detail where session_id=$1 and player_id=$2",[session,guest]
    );
    expect(nomineePositions.rows[0].positions).toEqual(["defender","goalkeeper"]);
    const points = await db.query<{ total_votes: string; points_per_vote: string; nomination_points: string }>(
      "select total_votes,points_per_vote,nomination_points from session_category_nomination_points where session_id=$1 and category='defender' and player_id=$2",
      [session,guest]
    );
    expect(Number(points.rows[0].total_votes)).toBe(4);
    expect(Number(points.rows[0].points_per_vote)).toBe(15);
    expect(Number(points.rows[0].nomination_points)).toBe(60);
    const noVotes = await db.query<{ nomination_points: string }>(
      "select coalesce(points.nomination_points,0)::numeric nomination_points from (values($1::uuid)) candidate(player_id) left join session_player_nomination_points points on points.session_id=$2 and points.player_id=candidate.player_id",
      [player,session]
    );
    expect(Number(noVotes.rows[0].nomination_points)).toBe(0);
  });
});
