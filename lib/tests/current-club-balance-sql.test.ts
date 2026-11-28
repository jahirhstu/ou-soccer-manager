import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let db: PGlite;
const season = "11111111-1111-4111-8111-111111111111";
const org = "22222222-2222-4222-8222-222222222222";
const player = "33333333-3333-4333-8333-333333333333";
const guest = "44444444-4444-4444-8444-444444444444";

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create table seasons(id uuid, organization_id uuid, program_id uuid);
    create table sessions(id uuid, season_id uuid, organization_id uuid, status text, session_date date);
    create table attendance(session_id uuid, player_id uuid, status text);
    create table session_player_charges(session_id uuid, player_id uuid, amount numeric);
    create table player_season_payment_summary(season_id uuid, player_id uuid, credit_amount numeric, owes_money numeric);
    create function can_manage_program_finance(uuid) returns boolean language sql as $$
      select coalesce(current_setting('test.allowed',true),'yes') <> 'no'; $$;
    create function admin_dashboard_season_finance(uuid) returns table(club_balance numeric)
      language sql as $$ select 3136.26::numeric; $$;
    insert into seasons values ('${season}','${org}','${org}');
    insert into sessions values ('${season}','${season}','${org}','scheduled',(now() at time zone 'America/Toronto')::date);
    insert into attendance values ('${season}','${player}','confirmed'),('${season}','${guest}','confirmed');
    insert into session_player_charges values ('${season}','${player}',208),('${season}','${guest}',65);
    insert into player_season_payment_summary values ('${season}','${player}',2940,0),('${season}','${guest}',0,117);
  `);
  await db.exec(readFileSync("supabase/migrations/118_dashboard_current_club_balance.sql", "utf8"));
}, 30000);
afterAll(async () => { await db?.close(); });
async function balance(id = season) {
  return Number((await db.query<{ current_club_balance: string }>(
    "select * from admin_dashboard_current_club_balance($1)", [id])).rows[0].current_club_balance);
}
async function changed(sql: string, check: () => Promise<void>) {
  await db.exec("begin");
  try { await db.exec(sql); await check(); } finally { await db.exec("rollback"); }
}

describe("current club balance", () => {
  it("reconciles the production snapshot and restores credit per player without offsetting debt", async () => {
    expect(await balance()).toBe(-11.74);
  });
  it("retains posted charges for completed, past, played and replacement sessions", async () => {
    for (const sql of ["update sessions set status='completed'", "update sessions set session_date=session_date-1",
      "update attendance set status='played'", "update attendance set status='replacement'"]) {
      await changed(sql, async () => { expect(await balance()).toBe(196.26); });
    }
  });
  it("ignores waitlist charges and other-season charges", async () => {
    await changed("update attendance set status='waitlisted'", async () => { expect(await balance()).toBe(196.26); });
    await changed(`update sessions set season_id='${guest}'`, async () => { expect(await balance()).toBe(196.26); });
  });
  it("preserves signed player adjustments and includes all summary players", async () => {
    await changed("update player_season_payment_summary set credit_amount=credit_amount+10 where credit_amount>0", async () => {
      expect(await balance()).toBe(-21.74);
    });
    await changed("update player_season_payment_summary set owes_money=52 where owes_money>0", async () => {
      expect(await balance()).toBe(-24.74);
    });
  });
  it("returns the cash balance when no players exist", async () => {
    await changed("delete from player_season_payment_summary", async () => { expect(await balance()).toBe(3136.26); });
  });
  it("rejects unauthorized access and unknown seasons", async () => {
    await changed("set test.allowed='no'", async () => { await expect(balance()).rejects.toThrow("authorized program manager"); });
    await expect(balance(guest)).rejects.toThrow("authorized program manager");
  });
});
