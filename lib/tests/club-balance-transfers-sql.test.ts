import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

let db: PGlite;
const org = "11111111-1111-4111-8111-111111111111";
const program = "22222222-2222-4222-8222-222222222222";
const source = "33333333-3333-4333-8333-333333333333";
const destination = "44444444-4444-4444-8444-444444444444";
const profile = "55555555-5555-4555-8555-555555555555";
const submission = "66666666-6666-4666-8666-666666666666";
const secondSubmission = "77777777-7777-4777-8777-777777777777";

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select '${profile}'::uuid; $$;
    create function public.organization_role(uuid) returns text language sql as $$
      select case when $1 = '${org}'::uuid then coalesce(nullif(current_setting('test.role', true), ''), 'admin') else null end;
    $$;
    create table organizations(id uuid primary key);
    create table programs(id uuid primary key, organization_id uuid);
    create table profiles(id uuid primary key);
    create table seasons(id uuid primary key, organization_id uuid, program_id uuid, name text, start_date date);
    create table players(id uuid primary key, organization_id uuid, status text);
    create table payments(season_id uuid, organization_id uuid, session_id uuid, player_id uuid, amount numeric);
    create table club_expenses(id uuid primary key default gen_random_uuid(), organization_id uuid, program_id uuid, season_id uuid, session_id uuid, amount numeric);
    create table ledger_entries(season_id uuid, organization_id uuid, player_id uuid, type text, amount numeric);
    create table sessions(id uuid, season_id uuid);
    create table attendance(session_id uuid, player_id uuid);
    create table player_season_payment_summary(season_id uuid, player_id uuid, credit_amount numeric, waived_amount numeric);
    create table audit_logs(organization_id uuid, actor_id uuid, action text, entity_type text, entity_id uuid, old_data jsonb, new_data jsonb);
    insert into organizations values ('${org}');
    insert into programs values ('${program}','${org}');
    insert into profiles values ('${profile}');
    insert into seasons values
      ('${source}','${org}','${program}','Summer','2020-05-01'),
      ('${destination}','${org}','${program}','Fall','2020-09-01');
  `);
  await db.exec(readFileSync("supabase/migrations/078_club_balance_transfers.sql", "utf8"));
}, 30000);

beforeEach(async () => {
  await db.exec(`begin;
    insert into payments values ('${source}','${org}',null,'${profile}',100);
    insert into club_expenses(organization_id,program_id,season_id,amount) values ('${org}','${program}','${source}',20);
    insert into player_season_payment_summary values ('${source}','${profile}',20,0);
  `);
});
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db?.close(); });

async function finance(seasonId: string) {
  return (await db.query<Record<string, string>>("select * from admin_dashboard_season_finance($1)", [seasonId])).rows[0];
}
async function summary(seasonId: string) {
  return (await db.query<Record<string, string>>("select * from admin_club_transfer_summary($1)", [seasonId])).rows[0];
}
async function transfer(amount: string, key = submission, from = source, to = destination) {
  return (await db.query<{ id: string }>("select record_club_balance_transfer($1,$2,$3,'2020-09-01',null,$4) id", [from, to, amount, key])).rows[0].id;
}
async function rejected(action: () => Promise<unknown>, message: string) {
  await db.exec("savepoint rejected_call");
  await expect(action()).rejects.toThrow(message);
  await db.exec("rollback to savepoint rejected_call; release savepoint rejected_call");
}

describe("club balance transfers", () => {
  it.each([["60.00", 0, 60], ["12.34", 47.66, 12.34]])("carries positive %s without adding revenue or expenses", async (amount, sourceAfter, destinationAfter) => {
    await transfer(amount);
    const oldFinance = await finance(source);
    const newFinance = await finance(destination);
    expect(Number(oldFinance.total_collected)).toBe(100);
    expect(Number(oldFinance.total_expenses)).toBe(20);
    expect(Number(oldFinance.total_player_credit)).toBe(20);
    expect(Number(oldFinance.net_club_balance)).toBe(sourceAfter);
    expect(Number(newFinance.net_club_balance)).toBe(destinationAfter);
    expect(Number((await summary(source)).season_result)).toBe(60);
    expect((await db.query("select * from payments")).rows).toHaveLength(1);
    expect((await db.query("select * from audit_logs")).rows).toHaveLength(1);
  });

  it("carries a partial deficit with its negative sign", async () => {
    await db.exec("update club_expenses set amount=150; update player_season_payment_summary set credit_amount=0");
    await transfer("-20.00");
    expect(Number((await finance(source)).net_club_balance)).toBe(-30);
    expect(Number((await finance(destination)).net_club_balance)).toBe(-20);
    expect(Number((await summary(source)).season_result)).toBe(-50);
  });

  it("uses the current net after player credit is carried separately", async () => {
    await db.exec(`update player_season_payment_summary set credit_amount=0 where season_id='${source}';
      insert into player_season_payment_summary values ('${destination}','${profile}',20,0);`);
    await transfer("80.00");
    expect(Number((await finance(source)).net_club_balance)).toBe(0);
    expect(Number((await finance(destination)).club_balance)).toBe(80);
    expect(Number((await finance(destination)).net_club_balance)).toBe(60);
  });

  it("caps repeated partial transfers at the remaining signed balance", async () => {
    await transfer("20.00");
    await transfer("40.00", secondSubmission);
    expect(Number((await finance(source)).net_club_balance)).toBe(0);
    await rejected(() => transfer("0.01", "88888888-8888-4888-8888-888888888888"), "exceeds");
  });

  it("is idempotent and reverses exactly once without deleting the original", async () => {
    const id = await transfer("10.00");
    expect(await transfer("10.00")).toBe(id);
    const reverse = (await db.query<{ id: string }>("select reverse_club_balance_transfer($1,$2) id", [id, secondSubmission])).rows[0].id;
    expect((await db.query<{ id: string }>("select reverse_club_balance_transfer($1,$2) id", [id, secondSubmission])).rows[0].id).toBe(reverse);
    await rejected(() => db.query("select reverse_club_balance_transfer($1,$2)", [id, "88888888-8888-4888-8888-888888888888"]), "already reversed");
    expect(Number((await finance(source)).net_club_balance)).toBe(60);
    expect(Number((await finance(destination)).net_club_balance)).toBe(0);
    expect((await db.query("select * from club_balance_transfers")).rows).toHaveLength(2);
  });

  it("rejects excess, opposite-sign, duplicate-key, earlier and cross-program transfers", async () => {
    await rejected(() => transfer("61.00"), "exceeds");
    await rejected(() => transfer("-1.00"), "exceeds");
    await rejected(() => transfer("0"), "nonzero");
    await rejected(() => transfer("10.001"), "two decimal");
    await rejected(() => transfer("10.00", submission, destination, source), "later season");
    await db.exec(`update seasons set program_id='${source}' where id='${destination}'`);
    await rejected(() => transfer("10.00"), "same program");
    await db.exec(`update seasons set program_id='${program}' where id='${destination}'`);
    await db.exec(`update seasons set organization_id='${source}' where id='${destination}'`);
    await rejected(() => transfer("10.00"), "same program");
    await db.exec(`update seasons set organization_id='${org}' where id='${destination}'`);
    await transfer("10.00");
    await rejected(() => transfer("11.00"), "Submission ID is already used");
  });

  it("blocks unassigned expenses and non-admin calls", async () => {
    await db.exec("alter table club_expenses drop constraint club_expenses_season_required");
    await db.query("insert into club_expenses(organization_id,program_id,season_id,amount) values ($1,$2,null,5)", [org, program]);
    await rejected(() => transfer("10.00"), "Assign all unallocated");
    await db.exec("set local test.role='player'");
    await rejected(() => transfer("10.00"), "Only an organization admin");
  });

  it("allocates a legacy expense and audits that assignment atomically", async () => {
    await db.exec("alter table club_expenses drop constraint club_expenses_season_required");
    const id = (await db.query<{ id: string }>("insert into club_expenses(organization_id,program_id,season_id,amount) values ($1,$2,null,5) returning id", [org, program])).rows[0].id;
    await db.exec("alter table club_expenses add constraint club_expenses_season_required check(season_id is not null) not valid");
    await rejected(() => transfer("10.00"), "Assign all unallocated");
    await db.query("select assign_club_expense_season($1,$2)", [id, source]);
    expect((await db.query<{ season_id: string }>("select season_id from club_expenses where id=$1", [id])).rows[0].season_id).toBe(source);
    expect((await db.query<{ action: string }>("select action from audit_logs")).rows[0].action).toBe("expense_season_assigned");
    await transfer("10.00");
  });

  it("rolls back the transfer if its audit record fails", async () => {
    await db.exec("alter table audit_logs add constraint reject_club_audit check(action <> 'club_balance_transferred')");
    await rejected(() => transfer("10.00"), "reject_club_audit");
    expect((await db.query("select * from club_balance_transfers")).rows).toHaveLength(0);
    expect(Number((await finance(source)).net_club_balance)).toBe(60);
  });
});
