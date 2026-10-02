import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, afterEach, afterAll, describe, expect, it } from "vitest";

let db: PGlite;
const org = "11111111-1111-4111-8111-111111111111";
const program = "22222222-2222-4222-8222-222222222222";
const source = "33333333-3333-4333-8333-333333333333";
const destination = "44444444-4444-4444-8444-444444444444";
const player = "55555555-5555-4555-8555-555555555555";
const submission = "66666666-6666-4666-8666-666666666666";
const secondSubmission = "77777777-7777-4777-8777-777777777777";

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select '${player}'::uuid; $$;
    create function public.organization_role(uuid) returns text language sql as $$
      select case when $1 = '${org}'::uuid then coalesce(nullif(current_setting('test.role', true), ''), 'admin') else null end;
    $$;
    create table organizations(id uuid, slug text, public_reports_enabled boolean);
    create table programs(id uuid, organization_id uuid, slug text);
    create table players(id uuid primary key, organization_id uuid, display_name text, status text);
    create table seasons(id uuid primary key, organization_id uuid, program_id uuid, name text, start_date date, status text, created_at timestamptz, price_per_session numeric);
    create table payments(id uuid default gen_random_uuid(), organization_id uuid, program_id uuid, season_id uuid, session_id uuid, player_id uuid, amount numeric, sessions_covered numeric);
    create table sessions(id uuid primary key, season_id uuid, session_date date, status text, price_per_session numeric, name text, created_at timestamptz);
    create table attendance(session_id uuid, player_id uuid, status text);
    create table session_player_charges(id uuid default gen_random_uuid(), session_id uuid, player_id uuid, amount numeric, waiver_amount numeric);
    create table ledger_entries(id uuid primary key default gen_random_uuid(), organization_id uuid, program_id uuid,
      season_id uuid, session_id uuid, player_id uuid, type text, amount numeric(10,2), sessions_count numeric,
      description text, created_by uuid, created_at timestamptz default now());
    create table goals(id uuid, session_id uuid, scorer_id uuid, assist_player_id uuid, goal_count integer, goal_type text);
    create table audit_logs(id uuid default gen_random_uuid(), organization_id uuid, actor_id uuid, action text, entity_type text, entity_id uuid, new_data jsonb);
    create table club_expenses(organization_id uuid, program_id uuid, season_id uuid, amount numeric);
  `);
  for (const migration of ["074_player_refunds", "075_season_credit_carry_forward", "076_dashboard_season_finance", "077_carry_forward_balances"]) {
    await db.exec(readFileSync(`supabase/migrations/${migration}.sql`, "utf8"));
  }
}, 30000);

beforeEach(async () => {
  await db.exec(`begin;
    insert into organizations values ('${org}','ou-soccer',true);
    insert into programs values ('${program}','${org}','football');
    insert into players values ('${player}','${org}','Test player','active');
    insert into seasons values
      ('${source}','${org}','${program}','Summer','2020-01-01','archived',now(),12),
      ('${destination}','${org}','${program}','Fall','2020-09-01','active',now(),12);
    insert into sessions values ('${source}','${source}','2020-01-01','completed',12,'Game one',now()),
      ('${program}','${source}','2020-01-08','completed',12,'Game two',now());
    insert into attendance values ('${source}','${player}','played'),('${program}','${player}','played');
    insert into session_player_charges(session_id,player_id,amount,waiver_amount) values ('${source}','${player}',12,0),('${program}','${player}',12,0);
    insert into payments(organization_id,program_id,season_id,player_id,amount) values ('${org}','${program}','${destination}','${player}',10);
  `);
});
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db?.close(); });

async function transfer(amount = "24.00", kind = "debt", key = submission, from = source, to = destination) {
  return (await db.query<{ id: string }>("select carry_forward_player_balance($1,$2,$3,$4,$5,$6,$7,$8) id", [player, from, to, amount, "2020-01-01", null, key, kind])).rows[0].id;
}
async function balances() {
  const rows = (await db.query<{ season_id: string; balance: string }>("select season_id,credit_amount-owes_money balance from player_season_payment_summary where player_id=$1", [player])).rows;
  return { source: Number(rows.find((r) => r.season_id === source)!.balance), destination: Number(rows.find((r) => r.season_id === destination)!.balance) };
}
async function rejected(action: () => Promise<unknown>, message: string) {
  await db.exec("savepoint rejected_call");
  await expect(action()).rejects.toThrow(message);
  await db.exec("rollback to savepoint rejected_call; release savepoint rejected_call");
}

describe("atomic balance carry-forward", () => {
  it.each([["24.00", 0, -14], ["12.00", -12, -2]])("moves debt of %s and offsets destination credit", async (amount, expectedSource, expectedDestination) => {
    await transfer(String(amount));
    const result = await balances();
    expect(result).toEqual({ source: expectedSource, destination: expectedDestination });
    expect(result.source + result.destination).toBe(-14);
    const entries = (await db.query<{ type: string; amount: string }>("select type,amount from ledger_entries order by type")).rows;
    expect(entries.map((r) => r.type)).toEqual(["debt_transferred_in", "debt_transferred_out"]);
    expect(entries.every((r) => Number(r.amount) === Number(amount))).toBe(true);
    expect((await db.query("select * from audit_logs")).rows).toHaveLength(1);
    expect((await db.query("select * from payments")).rows).toHaveLength(1);
    expect((await db.query("select * from attendance")).rows).toHaveLength(2);
    expect((await db.query("select * from session_player_charges")).rows).toHaveLength(2);
  });

  it("supports inactive players and destinations without registration or attendance", async () => {
    await db.query("update players set status='inactive' where id=$1", [player]);
    await transfer();
    expect(await balances()).toEqual({ source: 0, destination: -14 });
  });

  it("shows debt-only destinations without payments, registration or attendance", async () => {
    await db.exec("delete from payments");
    await transfer();
    expect(await balances()).toEqual({ source: 0, destination: -24 });
    const report = (await db.query<{ owes_money: string }>("select * from public_player_report() where player_id=$1 and season_id=$2", [player, destination])).rows;
    expect(report).toHaveLength(1);
    expect(Number(report[0].owes_money)).toBe(24);
  });

  it("preserves old credit RPC behavior and offsets source debt with transferred credit", async () => {
    await db.query("select carry_forward_player_credit($1,$2,$3,10,'2020-01-01',null,$4)", [player, destination, source, submission]);
    expect(await balances()).toEqual({ source: -14, destination: 0 });
  });

  it.each(["26.00", "5.25"])("supports full and partial credit transfer of %s", async (amount) => {
    await db.query("insert into ledger_entries(organization_id,program_id,season_id,player_id,type,amount) values($1,$2,$3,$4,'credit_added',50)", [org, program, source, player]);
    await transfer(amount, "credit");
    expect(await balances()).toEqual({ source: 26 - Number(amount), destination: 10 + Number(amount) });
  });

  it("retries a completed submission without charging twice", async () => {
    const first = await transfer();
    expect(await transfer()).toBe(first);
    expect((await db.query("select * from ledger_entries")).rows).toHaveLength(2);
    expect((await db.query("select * from audit_logs")).rows).toHaveLength(1);
    await rejected(() => transfer("12.00"), "Submission ID is already used");
  });

  it("rejects zero, excessive, wrong-kind, same-season and stale requests", async () => {
    await rejected(() => transfer("0"), "positive");
    await rejected(() => transfer("24.001"), "two decimal");
    await rejected(() => transfer("25"), "exceeds");
    await rejected(() => transfer("1", "credit"), "exceeds");
    await rejected(() => transfer("1", "debt", submission, source, source), "different seasons");
    await transfer();
    await rejected(() => transfer("1", "debt", secondSubmission), "exceeds");
    expect((await db.query("select * from ledger_entries")).rows).toHaveLength(2);
  });

  it("rejects cross-program, cross-organization and non-admin requests", async () => {
    await db.query("update seasons set program_id=$1 where id=$2", [source, destination]);
    await rejected(() => transfer(), "same program");
    await db.query("update seasons set program_id=$1,organization_id=$2 where id=$3", [program, source, destination]);
    await rejected(() => transfer(), "same program");
    await db.query("update seasons set organization_id=$1 where id=$2", [org, destination]);
    await db.exec("set local test.role='player'");
    await rejected(() => transfer(), "Only an organization admin");
  });

  it("rolls back both ledger entries when audit creation fails", async () => {
    await db.exec("alter table audit_logs add constraint reject_audit check(action <> 'player_debt_carried_forward')");
    await rejected(() => transfer(), "reject_audit");
    expect((await db.query("select * from ledger_entries")).rows).toHaveLength(0);
    expect(await balances()).toEqual({ source: -24, destination: 10 });
  });

  it("shows destination debt in public reports and decreases unused credit without changing cash", async () => {
    const before = (await db.query<{ club_balance: string; total_player_credit: string }>("select * from admin_dashboard_season_finance($1)", [destination])).rows[0];
    await transfer();
    const after = (await db.query<{ club_balance: string; total_player_credit: string }>("select * from admin_dashboard_season_finance($1)", [destination])).rows[0];
    expect(Number(before.club_balance)).toBe(10); expect(Number(after.club_balance)).toBe(10);
    expect(Number(before.total_player_credit)).toBe(10); expect(Number(after.total_player_credit)).toBe(0);
    const report = (await db.query<{ owes_money: string; balance_amount: string }>("select * from public_player_report() where player_id=$1 and season_id=$2", [player, destination])).rows[0];
    expect(Number(report.owes_money)).toBe(14); expect(Number(report.balance_amount)).toBe(-14);
    const history = (await db.query<{ debt_transfer_in_amount: string; transfer_in_amount: string }>("select * from player_season_transfer_summary where season_id=$1", [destination])).rows[0];
    expect(Number(history.debt_transfer_in_amount)).toBe(24); expect(Number(history.transfer_in_amount)).toBe(0);
  });
});
