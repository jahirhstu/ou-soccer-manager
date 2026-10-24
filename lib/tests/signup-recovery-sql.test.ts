import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const org = "bc8032b0-1ce1-4f2c-93d1-df439a815274";
const program = "3d77bfb1-cb3b-41bb-bf96-d744aea5ed66";
const fall = "6c14cad3-7174-46e3-8598-3de6196e58b9";
const summer = "3d3e9d51-1f97-4899-8046-89ecac4cd1b4";
const importId = "debbe090-b907-472a-bb74-6718d5860a6f";
const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const identities = [
  ["Jahir", "2d4efe3c-6c74-4625-8172-7d40da278071"],
  ["Shaiful", "2e5e7d50-a455-44e5-9726-4083f26184d0"],
  ["Arnab", "4bdafed7-f2e5-48b2-8f9b-7c85cfbe91b4"],
  ["Morshadul", "b343f96b-209a-450b-a2fe-96dc8f24386b"],
  ["Ahmed", "a8531627-98d7-461c-9d93-f8d337cac60f"],
  ["Sadat", "117951ab-ec68-4496-b7b2-34b984bac444"],
  ["Naveed", "2b6b2647-8106-4173-8d86-a9110defa91f"],
  ["Shimul", "9951c485-fbf2-4fa1-b0f1-c0b9d14e0de4"],
  ["Rafiul", "74f400d8-a9a4-40a0-ab97-47ca9e9448a4"],
  ["Rocky", "8cc45867-359a-448f-be8e-f7420b3e4e66"],
  ["Rokibul", "5b0dff7e-1db4-4088-9fec-42979ae8cdc6"],
  ["Hazem", "e4e465b2-9ca1-4e3d-a11c-a1edc8fa3063"],
  ["Towhid", "4ddd3cfb-4685-4c17-af58-da1447156c0a"],
  ["Shihan", "a56f197e-e4da-4af2-a982-7221deda219e"],
  ["Wali", "b60149ac-8450-4c2f-9cdb-0a7d21a54c4f"],
  ["Mash", "c093216f-e4e8-431f-a0bf-213a531bf376"],
  ["Mustaqim", "7718943f-36f0-4bbb-b678-32d863bbdfff"],
  ["Arif", "c359f547-4a68-4747-843e-72e23c367e99"],
  ["Moshee", "429ccc2d-65a9-4a37-8eb8-3b2f2388f696"],
  ["Shafayet", "51279442-8e16-43c2-b4b5-82f0657c3d9b"],
  ["Shomi", "6b71ebee-4acc-440a-9d96-368216e88ee6"]
];
const repairSql = readFileSync("scripts/production/repair_fall_signup_import.sql", "utf8");
const reversalSql = readFileSync("scripts/production/rollback_fall_signup_import.sql", "utf8");
let db: PGlite;

function transactionBody(sql: string) {
  return sql.replace(/^begin;\s*/m, "").replace(/\nrollback;\s*$/, "\n");
}

function approvedRepair(waliPaid = false, mashPaid = false) {
  return transactionBody(repairSql)
    .replace("null::date", "date '2026-10-02'")
    .replace("null::boolean,", `${waliPaid},`)
    .replace("null::boolean  --", `${mashPaid}  --`);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create table players(id uuid primary key, display_name text, status text, organization_id uuid);
    create table seasons(id uuid primary key, name text, start_date date, price_per_session numeric, organization_id uuid, program_id uuid);
    create table sessions(id uuid primary key, season_id uuid, session_date date, status text, price_per_session numeric, name text, created_at timestamptz);
    create table attendance(player_id uuid, session_id uuid, status text);
    create table payments(id uuid primary key default gen_random_uuid(), player_id uuid, season_id uuid, session_id uuid,
      amount numeric(10,2), sessions_covered numeric, payment_date date, payment_method text, reference_note text,
      created_by uuid, organization_id uuid, program_id uuid);
    create table ledger_entries(id uuid primary key default gen_random_uuid(), player_id uuid, season_id uuid, session_id uuid,
      type text, amount numeric(10,2), sessions_count numeric, description text, created_by uuid, organization_id uuid, program_id uuid);
    create table session_player_charges(id uuid, session_id uuid, player_id uuid, amount numeric, waiver_amount numeric, ledger_entry_id uuid);
    create table goals(id uuid, session_id uuid, scorer_id uuid, assist_player_id uuid, goal_type text, goal_count integer);
    create table whatsapp_imports(id uuid primary key, season_id uuid, organization_id uuid, status text, parsed_json jsonb, created_by uuid, confirmed_by uuid);
    create table audit_logs(id uuid primary key default gen_random_uuid(), organization_id uuid, actor_id uuid, action text,
      entity_type text, entity_id uuid, old_data jsonb, new_data jsonb, created_at timestamptz default now());
    create table notifications(payment_id uuid);
    insert into seasons values
      ('${summer}', 'Summer 2026', '2026-05-20', 12, '${org}', '${program}'),
      ('${fall}', 'Fall 2026', null, 13, '${org}', '${program}');
  `);
  for (const [name, id] of identities) {
    await db.query("insert into players values ($1,$2,'active',$3)", [id, name, org]);
  }
  await db.query("insert into whatsapp_imports values ($1,$2,$3,'confirmed',$4,$5,$5)", [
    importId, fall, org,
    JSON.stringify({
      importType: "season_signup",
      players: identities.map(([name, matchedPlayerId]) => ({ name, matchedPlayerId })),
      payments: identities.map(([playerName, matchedPlayerId]) => ({
        playerName, matchedPlayerId, amount: playerName === "Shomi" ? 123 : 195,
        note: "Paid", amountSource: "player_line", paymentMethod: "e-transfer"
      }))
    }), actor
  ]);
  await db.query("insert into payments(player_id,season_id,amount) values ($1,$2,192)", [identities[0][1], summer]);
  await db.query("insert into ledger_entries(player_id,season_id,type,amount) values ($1,$2,'credit_transferred_in',72)", [identities[20][1], fall]);
  const creditSql = readFileSync("supabase/migrations/077_carry_forward_balances.sql", "utf8");
  await db.exec(creditSql.slice(creditSql.indexOf("create or replace view public.player_season_payment_summary")));
  await db.exec(readFileSync("supabase/migrations/079_public_report_signup_roster.sql", "utf8"));
}, 30000);

beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db?.close(); });

async function cash() {
  return (await db.query<{ total: string; count: number }>("select coalesce(sum(amount),0) total,count(*)::int count from payments where season_id=$1", [fall])).rows[0];
}

describe("exact Fall signup recovery SQL", () => {
  it("requires confirmation of the date and disputed payments before inserting anything", async () => {
    await expect(db.exec(transactionBody(repairSql))).rejects.toThrow("Confirm payment_date, wali_paid, and mash_paid");
    await db.exec("rollback");
    expect(await cash()).toEqual({ total: "0", count: 0 });
  });

  it("records only 19 approved receipts and preserves Summer and carried credit", async () => {
    await db.exec(approvedRepair());
    const row = await cash();
    expect(Number(row.total)).toBe(3633);
    expect(row.count).toBe(19);
    expect((await db.query("select * from ledger_entries where type='payment_received'")).rows).toHaveLength(19);
    expect((await db.query("select * from audit_logs where action='payment_import_recovered'")).rows).toHaveLength(19);
    const report = (await db.query<Record<string, any>>("select * from public_player_report() where season_id=$1", [fall])).rows;
    expect(report).toHaveLength(21);
    expect(report.reduce((sum, player) => sum + Number(player.total_paid_amount), 0)).toBe(3633);
    expect(report.reduce((sum, player) => sum + Number(player.credit_amount), 0)).toBe(3705);
    expect(Number(report.find((player) => player.player_name === "Shomi")!.balance_amount)).toBe(195);
    expect(Number(report.find((player) => player.player_name === "Wali")!.total_paid_amount)).toBe(0);
    const summerBalance = (await db.query<{ credit_amount: string }>("select credit_amount from player_season_payment_summary where player_id=$1 and season_id=$2", [identities[0][1], summer])).rows[0];
    expect(Number(summerBalance.credit_amount)).toBe(192);
  });

  it("includes Wali and Mash only when their payments are explicitly approved", async () => {
    await db.exec(approvedRepair(true, true));
    const row = await cash();
    expect(Number(row.total)).toBe(4023);
    expect(row.count).toBe(21);
  });

  it("does not duplicate cash, ledgers, or audits if recovery is repeated", async () => {
    await db.exec(approvedRepair());
    await db.exec("drop table fall_signup_repair_settings,fall_signup_repair_players,fall_signup_balances_before");
    await db.exec(approvedRepair());
    expect((await cash()).count).toBe(19);
    expect((await db.query("select * from ledger_entries where type='payment_received'")).rows).toHaveLength(19);
    expect((await db.query("select * from audit_logs")).rows).toHaveLength(19);
  });

  it("rolls the entire correction back when an unrelated Fall receipt is found", async () => {
    await db.query("insert into payments(player_id,season_id,amount,reference_note) values ($1,$2,195,'Another transfer')", [identities[10][1], fall]);
    await expect(db.exec(approvedRepair())).rejects.toThrow("Another Fall payment exists");
    await db.exec("rollback");
    expect((await cash()).count).toBe(0);
    expect((await db.query("select * from ledger_entries where type='payment_received'")).rows).toHaveLength(0);
  });

  it("can reverse only the recovered UUIDs and safely retry the reversal", async () => {
    await db.exec(approvedRepair());
    await db.exec(transactionBody(reversalSql));
    expect((await cash()).count).toBe(0);
    expect((await db.query("select * from ledger_entries where type='payment_received'")).rows).toHaveLength(0);
    expect((await db.query("select * from payments where season_id=$1", [summer])).rows).toHaveLength(1);
    expect((await db.query("select * from ledger_entries where type='credit_transferred_in'")).rows).toHaveLength(1);
    await db.exec(transactionBody(reversalSql));
    expect((await db.query("select * from audit_logs where action='payment_import_recovery_reversed'")).rows).toHaveLength(19);
  });

  it("preserves a receipt that already existed when only its ledger was recovered", async () => {
    await db.query(`insert into payments(player_id,season_id,amount,payment_date,payment_method,reference_note)
      values ($1,$2,195,'2026-10-02','e-transfer','WhatsApp import debbe090-b907-472a-bb74-6718d5860a6f: Paid')`, [identities[0][1], fall]);
    await db.exec(approvedRepair());
    expect((await cash()).count).toBe(19);
    await db.exec(transactionBody(reversalSql));
    expect((await cash()).count).toBe(1);
    expect((await db.query("select * from ledger_entries where type='payment_received'")).rows).toHaveLength(0);
  });

  it("refuses to reverse a recovered payment that was subsequently changed", async () => {
    await db.exec(approvedRepair());
    await db.query("update payments set amount=196 where season_id=$1 and player_id=$2", [fall, identities[0][1]]);
    await expect(db.exec(transactionBody(reversalSql))).rejects.toThrow("changed or acquired a dependent record");
  });

  it("keeps the shipped script in dry-run mode", () => {
    expect(repairSql.trim()).toMatch(/rollback;$/);
    expect(reversalSql.trim()).toMatch(/rollback;$/);
  });
});
