import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, afterEach, afterAll, describe, expect, it } from "vitest";

let db: PGlite;
const org = "11111111-1111-4111-8111-111111111111";
const program = "22222222-2222-4222-8222-222222222222";
const season = "33333333-3333-4333-8333-333333333333";
const otherSeason = "44444444-4444-4444-8444-444444444444";
const funding = "55555555-5555-4555-8555-555555555555";
const recipient = "66666666-6666-4666-8666-666666666666";
const submission = "77777777-7777-4777-8777-777777777777";
const second = "88888888-8888-4888-8888-888888888888";

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql as $$ select '${funding}'::uuid; $$;
    create function organization_role(uuid) returns text language sql as $$
      select case when $1 = '${org}'::uuid then coalesce(nullif(current_setting('test.role', true), ''), 'admin') else null end;
    $$;
    create table organizations(id uuid, slug text, public_reports_enabled boolean);
    create table programs(id uuid, organization_id uuid, slug text);
    create table players(id uuid primary key, organization_id uuid, display_name text, status text);
    create table seasons(id uuid primary key, organization_id uuid, program_id uuid, name text, start_date date, status text, created_at timestamptz, price_per_session numeric);
    create table payments(id uuid default gen_random_uuid(), organization_id uuid, program_id uuid, season_id uuid, session_id uuid, player_id uuid, amount numeric, sessions_covered numeric);
    create table sessions(id uuid primary key, season_id uuid, organization_id uuid, program_id uuid, session_date date, status text, price_per_session numeric, name text, created_at timestamptz);
    create table attendance(session_id uuid, player_id uuid, status text);
    create table session_player_charges(id uuid default gen_random_uuid(), session_id uuid, player_id uuid, amount numeric, waiver_amount numeric);
    create table ledger_entries(id uuid primary key default gen_random_uuid(), organization_id uuid, program_id uuid,
      season_id uuid, session_id uuid, player_id uuid, related_player_id uuid, type text, amount numeric(10,2), sessions_count numeric,
      description text, created_by uuid, created_at timestamptz default now());
    create table goals(id uuid, session_id uuid, scorer_id uuid, assist_player_id uuid, goal_count integer, goal_type text);
    create table audit_logs(id uuid default gen_random_uuid(), organization_id uuid, actor_id uuid, action text, entity_type text, entity_id uuid, new_data jsonb);
    create table club_expenses(organization_id uuid, program_id uuid, season_id uuid, amount numeric);
    create table whatsapp_imports(season_id uuid, organization_id uuid, status text, parsed_json jsonb);
  `);
  for (const migration of ["074_player_refunds", "075_season_credit_carry_forward", "076_dashboard_season_finance", "077_carry_forward_balances", "079_public_report_signup_roster", "080_player_credit_transfers"]) {
    await db.exec(readFileSync(`supabase/migrations/${migration}.sql`, "utf8"));
  }
}, 30000);
beforeEach(async () => {
  await db.exec(`begin;
    insert into organizations values ('${org}','ou-soccer',true);
    insert into programs values ('${program}','${org}','football');
    insert into players values ('${funding}','${org}','Funding player','active'),('${recipient}','${org}','Guest','active');
    insert into seasons values ('${season}','${org}','${program}','Fall','2020-09-01','active',now(),13),
      ('${otherSeason}','${org}','${program}','Winter','2021-01-01','draft',now(),13);
    insert into sessions values ('${season}','${season}','${org}','${program}','2020-10-04','completed',13,'Guest session',now()),
      ('${otherSeason}','${otherSeason}','${org}','${program}','2021-01-01','scheduled',13,'Other season',now());
    insert into payments(organization_id,program_id,season_id,player_id,amount) values ('${org}','${program}','${season}','${funding}',40);
    insert into attendance values ('${season}','${recipient}','played');
    insert into session_player_charges(session_id,player_id,amount,waiver_amount) values ('${season}','${recipient}',13,0);
  `);
});
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db?.close(); });

async function transfer(amount = "13.00", key = submission, from = funding, to = recipient, targetSeason = season, sessionId: string | null = season, date = "2020-10-04") {
  return (await db.query<{ id: string }>("select transfer_player_credit($1,$2,$3,$4,$5,$6,$7,$8) id", [from, to, targetSeason, amount, date, sessionId, "Guest fee", key])).rows[0].id;
}
async function balances() {
  const rows = (await db.query<{ player_id: string; balance: string }>("select player_id,credit_amount-owes_money balance from player_season_payment_summary where season_id=$1", [season])).rows;
  return { funding: Number(rows.find(row => row.player_id === funding)!.balance), recipient: Number(rows.find(row => row.player_id === recipient)!.balance) };
}
async function rejected(action: () => Promise<unknown>, message: string) {
  await db.exec("savepoint rejected_call");
  await expect(action()).rejects.toThrow(message);
  await db.exec("rollback to savepoint rejected_call; release savepoint rejected_call");
}

describe("atomic player credit transfers", () => {
  it.each([["13.00",27,0],["6.50",33.5,-6.5],["20.00",20,7],["40.00",0,27]])("moves %s without creating cash or changing charges", async (amount, from, to) => {
    await transfer(String(amount));
    const result = await balances();
    expect(result).toEqual({ funding: from, recipient: to });
    expect(result.funding + result.recipient).toBe(27);
    const entries = (await db.query<{ type: string; related_player_id: string; transfer_id: string; amount: string }>("select * from ledger_entries order by type")).rows;
    expect(entries).toHaveLength(2);
    expect(entries[0].transfer_id).toBe(entries[1].transfer_id);
    expect(entries.map(row => row.related_player_id)).toEqual([funding,recipient]);
    expect(entries.every(row => Number(row.amount) === Number(amount))).toBe(true);
    expect((await db.query("select * from audit_logs where action='player_credit_transferred'")).rows).toHaveLength(1);
    expect((await db.query("select * from payments")).rows).toHaveLength(1);
    expect((await db.query("select * from attendance")).rows).toHaveLength(1);
    expect((await db.query("select * from session_player_charges where amount=13")).rows).toHaveLength(1);
    expect((await db.query("select * from ledger_entries where season_id=$1", [otherSeason])).rows).toHaveLength(0);
  });
  it("supports inactive funding and recipient players and unregistered prepaid guests", async () => {
    await db.exec("delete from attendance; delete from session_player_charges; update players set status='inactive'");
    await transfer("12.34", submission, funding, recipient, season, null);
    expect(await balances()).toEqual({ funding: 27.66, recipient: 12.34 });
  });
  it("makes retry idempotent even after all available credit was transferred", async () => {
    const id = await transfer("40.00");
    expect(await transfer("40.00")).toBe(id);
    expect((await db.query("select * from ledger_entries")).rows).toHaveLength(2);
    await rejected(() => transfer("39.00"), "Submission ID is already used");
    await rejected(() => transfer("40.00", submission, funding, recipient, season, null), "Submission ID is already used");
    await rejected(() => transfer("0.01", second), "exceeds current season credit");
  });
  it("rejects invalid amounts, self transfer, wrong session and future dates", async () => {
    for (const amount of ["0", "-1", "1.234", "NaN", "Infinity"]) await rejected(() => transfer(amount), "positive");
    await rejected(() => transfer("41"), "exceeds");
    await rejected(() => transfer("1", submission, funding, funding), "different players");
    await rejected(() => transfer("1", submission, funding, recipient, season, otherSeason), "Session must belong");
    await rejected(() => transfer("1", submission, funding, recipient, season, null, "2999-01-01"), "not in the future");
  });
  it("rejects missing/cross-organization players and non-admin access", async () => {
    await rejected(() => transfer("1", submission, funding, second), "Both players");
    await db.query("update players set organization_id=$1 where id=$2", [second, recipient]);
    await rejected(() => transfer(), "Both players");
    await db.exec("set local test.role='captain'");
    await rejected(() => transfer(), "Only an organization admin");
  });
  it("does not use credit from a different season", async () => {
    await rejected(() => transfer("1", submission, funding, recipient, otherSeason, null), "exceeds current season credit");
    expect((await db.query("select * from ledger_entries")).rows).toHaveLength(0);
  });
  it("preserves cash and receipts while unused credit decreases only by debt settled", async () => {
    const before = (await db.query<any>("select * from admin_dashboard_season_finance($1)", [season])).rows[0];
    await transfer("20.00");
    const after = (await db.query<any>("select * from admin_dashboard_season_finance($1)", [season])).rows[0];
    for (const field of ["club_balance", "signup_collected", "drop_in_collected", "total_collected", "total_expenses", "total_refunded"]) expect(after[field]).toBe(before[field]);
    expect(Number(before.total_player_credit) - Number(after.total_player_credit)).toBe(13);
    expect(Number(after.net_club_balance) - Number(before.net_club_balance)).toBe(13);
    const report = (await db.query<any>("select * from public_player_report() where player_id=$1 and season_id=$2", [recipient, season])).rows[0];
    expect(Number(report.balance_amount)).toBe(7); expect(Number(report.total_paid_amount)).toBe(0);
    const summary = (await db.query<any>("select * from player_season_transfer_summary where player_id=$1 and season_id=$2", [recipient, season])).rows[0];
    expect(Number(summary.transfer_in_amount)).toBe(20);
  });
  it("preserves total positive credit when moving prepaid funds", async () => {
    await db.exec("delete from attendance; delete from session_player_charges");
    await transfer("20");
    const finance = (await db.query<any>("select * from admin_dashboard_season_finance($1)", [season])).rows[0];
    expect(Number(finance.total_player_credit)).toBe(40);
    const report = (await db.query<any>("select * from public_player_report() where player_id=$1 and season_id=$2", [recipient, season])).rows;
    expect(report).toHaveLength(1);
  });
  it("rolls back both entries if the audit insert fails", async () => {
    await db.exec("alter table audit_logs add constraint reject_audit check(action <> 'player_credit_transferred')");
    await rejected(() => transfer(), "reject_audit");
    expect((await db.query("select * from ledger_entries")).rows).toHaveLength(0);
    expect(await balances()).toEqual({ funding: 40, recipient: -13 });
  });
  it("shares the funding lock with refunds and season carry-forward and rechecks stale credit", async () => {
    await transfer("20");
    await db.query("select record_player_refund($1,$2,10,'2020-10-04','cash',null,$3)", [funding, season, second]);
    await rejected(() => transfer("11", org), "exceeds");
    await db.query("select carry_forward_player_credit($1,$2,$3,10,'2020-10-04',null,$4)", [funding, season, otherSeason, program]);
    await rejected(() => transfer("0.01", org), "exceeds");
    expect((await balances()).funding).toBe(0);
    const sql = readFileSync("supabase/migrations/080_player_credit_transfers.sql", "utf8");
    expect(sql).toContain("order by id for update");
    expect(sql.indexOf("order by id for update")).toBeLessThan(sql.indexOf("select credit_amount"));
  });
});
