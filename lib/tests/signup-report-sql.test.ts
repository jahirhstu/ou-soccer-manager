import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const org = "11111111-1111-4111-8111-111111111111";
const otherOrg = "22222222-2222-4222-8222-222222222222";
const fall = "6c14cad3-7174-46e3-8598-3de6196e58b9";
const summer = "3d3e9d51-1f97-4899-8046-89ecac4cd1b4";
const paid = "33333333-3333-4333-8333-333333333333";
const partial = "44444444-4444-4444-8444-444444444444";
const unpaid = "55555555-5555-4555-8555-555555555555";
const outsider = "66666666-6666-4666-8666-666666666666";
const session = "77777777-7777-4777-8777-777777777777";
let db: PGlite;

const previousSql = readFileSync("supabase/migrations/077_carry_forward_balances.sql", "utf8");
const previousReport = previousSql.slice(previousSql.indexOf("create or replace function public.public_player_report()"));

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create table players(id uuid primary key, display_name text, status text, organization_id uuid);
    create table seasons(id uuid primary key, name text, start_date date, price_per_session numeric, organization_id uuid);
    create table sessions(id uuid primary key, season_id uuid, session_date date, status text, price_per_session numeric, name text, created_at timestamptz);
    create table attendance(player_id uuid, session_id uuid, status text);
    create table payments(player_id uuid, season_id uuid, amount numeric, sessions_covered numeric);
    create table ledger_entries(player_id uuid, season_id uuid, type text, amount numeric);
    create table session_player_charges(id uuid, session_id uuid, player_id uuid, amount numeric, waiver_amount numeric);
    create table goals(id uuid, session_id uuid, scorer_id uuid, assist_player_id uuid, goal_type text, goal_count integer);
    create table whatsapp_imports(id uuid default gen_random_uuid(), season_id uuid, organization_id uuid, status text, parsed_json jsonb);
    insert into players values
      ('${paid}', 'Jahir', 'active', '${org}'),
      ('${partial}', 'Shomi', 'active', '${org}'),
      ('${unpaid}', 'Mash', 'active', '${org}'),
      ('${outsider}', 'Unrelated', 'active', '${org}');
    insert into seasons values
      ('${summer}', 'Summer 2026', '2026-05-20', 12, '${org}'),
      ('${fall}', 'Fall 2026', null, 13, '${org}');
    insert into sessions values ('${session}', '${summer}', '2026-05-20', 'completed', 12, 'May 20', now());
    insert into attendance values ('${paid}', '${session}', 'played');
    insert into payments values
      ('${paid}', '${summer}', 192, 16),
      ('${paid}', '${fall}', 195, null),
      ('${partial}', '${fall}', 123, null);
    insert into ledger_entries values
      ('${paid}', '${fall}', 'payment_received', 195),
      ('${partial}', '${fall}', 'payment_received', 123),
      ('${partial}', '${fall}', 'credit_transferred_in', 72);
  `);
  await db.exec(previousSql.slice(previousSql.indexOf("create or replace view public.player_season_payment_summary")));
  await db.exec(readFileSync("supabase/migrations/079_public_report_signup_roster.sql", "utf8"));
}, 30000);

beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db?.close(); });

async function signup(playerIds = [paid, partial, unpaid], status = "confirmed", importType = "season_signup", organizationId = org) {
  await db.query("insert into whatsapp_imports(season_id,organization_id,status,parsed_json) values ($1,$2,$3,$4)", [
    fall, organizationId, status,
    JSON.stringify({ importType, players: playerIds.map((matchedPlayerId) => ({ name: "A name is not an identity", matchedPlayerId })) })
  ]);
}

async function report(seasonId = fall) {
  return (await db.query<Record<string, any>>("select * from public_player_report() where season_id=$1 order by player_name", [seasonId])).rows;
}

describe("public signup roster SQL", () => {
  it("includes an unpaid signup with zero balance before any session", async () => {
    await signup();
    const rows = await report();
    expect(rows.map((row) => row.player_name)).toEqual(["Jahir", "Mash", "Shomi"]);
    const mash = rows.find((row) => row.player_id === unpaid)!;
    expect(Number(mash.total_paid_amount)).toBe(0);
    expect(Number(mash.balance_amount)).toBe(0);
    expect(Number(mash.appearances)).toBe(0);
    expect(mash.latest_session).toBeNull();
  });

  it("fixes the previous report's omission without requiring another import", async () => {
    await signup();
    await db.exec(previousReport);
    expect((await report()).map((row) => row.player_name)).toEqual(["Jahir", "Shomi"]);
    await db.exec(readFileSync("supabase/migrations/079_public_report_signup_roster.sql", "utf8"));
    expect((await report()).map((row) => row.player_name)).toEqual(["Jahir", "Mash", "Shomi"]);
  });

  it("deduplicates repeated roster rows and repeated confirmed imports", async () => {
    await signup([paid, partial, unpaid, unpaid]);
    await signup();
    const rows = await report();
    expect(rows).toHaveLength(3);
    expect(rows.reduce((sum, row) => sum + Number(row.total_paid_amount), 0)).toBe(318);
    expect(rows.reduce((sum, row) => sum + Number(row.credit_amount), 0)).toBe(390);
  });

  it("counts imported cash once and adds previous-season credit", async () => {
    await signup();
    const rows = await report();
    expect(Number(rows.find((row) => row.player_id === paid)!.balance_amount)).toBe(195);
    expect(Number(rows.find((row) => row.player_id === partial)!.balance_amount)).toBe(195);
    const summary = (await db.query<{ credit: string }>("select sum(credit_amount) credit from player_season_payment_summary where season_id=$1", [fall])).rows[0];
    expect(rows.reduce((sum, row) => sum + Number(row.credit_amount), 0)).toBe(Number(summary.credit));
    const summerRows = await report(summer);
    expect(summerRows).toHaveLength(1);
    expect(Number(summerRows[0].total_paid_amount)).toBe(192);
    expect(Number(summerRows[0].balance_amount)).toBe(180);
  });

  it("keeps played-session charges, completed refunds, and adjustments in the balance", async () => {
    await signup();
    await db.query("insert into sessions values (gen_random_uuid(),$1,'2026-09-20','completed',13,'First Fall session',now())", [fall]);
    await db.query("insert into attendance select $1,id,'played' from sessions where season_id=$2", [paid, fall]);
    await db.query("insert into ledger_entries values ($1,$2,'refund_paid',25),($1,$2,'manual_adjustment',-7.50)", [paid, fall]);
    const jahir = (await report()).find((row) => row.player_id === paid)!;
    expect(Number(jahir.total_paid_amount)).toBe(195);
    expect(Number(jahir.estimated_used_amount)).toBe(13);
    expect(Number(jahir.balance_amount)).toBe(149.5);
    expect(Number(jahir.appearances)).toBe(1);
  });

  it("only accepts confirmed signup rosters with reviewed UUIDs in the correct organization", async () => {
    await signup([unpaid], "draft");
    await signup([unpaid], "confirmed", "session_update");
    await signup([unpaid], "confirmed", "season_signup", otherOrg);
    await db.query("insert into whatsapp_imports(season_id,organization_id,status,parsed_json) values ($1,$2,'confirmed',$3)", [
      fall, org, JSON.stringify({ importType: "season_signup", players: [{ name: "Mash" }, { matchedPlayerId: "invalid-uuid" }] })
    ]);
    expect((await report()).map((row) => row.player_name)).toEqual(["Jahir", "Shomi"]);
  });

  it("handles null or malformed roster JSON without breaking the public report", async () => {
    await db.query("insert into whatsapp_imports(season_id,organization_id,status,parsed_json) values ($1,$2,'confirmed',$3)", [
      fall, org, JSON.stringify({ importType: "season_signup", players: { name: "Mash" } })
    ]);
    expect(await report()).toHaveLength(2);
  });
});
