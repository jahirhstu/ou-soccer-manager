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
      ('create_organization_onboarding','transfer_player_credit','record_player_refund','record_club_balance_transfer','scoped_public_longest_winning_streaks')`);
    expect(result.rows).toHaveLength(5);
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
  it("keeps public season lookup and notification amounts behind the public scope", async () => {
    await db.query("update program_modules set enabled=false where program_id=$1 and module_key='public_reports'",[program]);
    await db.exec("set local role anon");
    expect((await db.query("select * from public_report_season('integration-a','soccer')")).rows).toHaveLength(0);
    expect((await db.query("select * from scoped_public_payment_notification_keys('integration-b','soccer')")).rows).toHaveLength(0);
    const scope = await db.query<{ program_id: string }>("select * from resolve_enabled_public_scope('integration-a',null)");
    expect(scope.rows.map(row => row.program_id)).toEqual([otherProgram]);
  });
});
