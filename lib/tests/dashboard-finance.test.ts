import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

let db: PGlite;
const org = "11111111-1111-4111-8111-111111111111";
const program = "22222222-2222-4222-8222-222222222222";
const season = "33333333-3333-4333-8333-333333333333";
const otherSeason = "44444444-4444-4444-8444-444444444444";
const player = "55555555-5555-4555-8555-555555555555";

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create table organizations(id uuid, slug text, public_reports_enabled boolean);
    create table programs(id uuid, organization_id uuid, slug text);
    create table seasons(id uuid, organization_id uuid, program_id uuid, name text, status text, start_date date, created_at timestamptz);
    create table players(id uuid, organization_id uuid, status text);
    create table payments(season_id uuid, organization_id uuid, session_id uuid, player_id uuid, amount numeric);
    create table club_expenses(season_id uuid, organization_id uuid, program_id uuid, amount numeric);
    create table ledger_entries(season_id uuid, organization_id uuid, player_id uuid, type text, amount numeric);
    create table sessions(id uuid, season_id uuid);
    create table attendance(session_id uuid, player_id uuid);
    create table player_season_payment_summary(season_id uuid, player_id uuid, credit_amount numeric, waived_amount numeric);
    create function organization_role(uuid) returns text language sql as $$ select coalesce(nullif(current_setting('test.role', true), ''), 'admin'); $$;
    insert into organizations values ('${org}', 'ou-soccer', true);
    insert into programs values ('${program}', '${org}', 'football');
    insert into seasons values
      ('${season}', '${org}', '${program}', 'Summer', 'active', '2026-05-01', '2026-01-01'),
      ('${otherSeason}', '${org}', '${program}', 'Fall', 'draft', '2026-10-01', '2026-09-01');
    insert into players values ('${player}', '${org}', 'inactive');
    insert into payments values
      ('${season}', '${org}', null, '${player}', 120),
      ('${season}', '${org}', '${season}', '${player}', 12),
      ('${season}', '${org}', '${season}', '${player}', 12),
      ('${otherSeason}', '${org}', null, '${player}', 999);
    insert into club_expenses values
      ('${season}', '${org}', '${program}', 15),
      (null, '${org}', '${program}', 5),
      (null, '${org}', '${otherSeason}', 777);
    insert into ledger_entries values ('${season}', '${org}', '${player}', 'refund_paid', 12);
    insert into player_season_payment_summary values
      ('${season}', '${player}', 25, 48),
      ('${season}', '${otherSeason}', 0, 0),
      ('${otherSeason}', '${player}', 500, 500);
  `);
  await db.exec(readFileSync("supabase/migrations/076_dashboard_season_finance.sql", "utf8"));
}, 30000);

afterAll(async () => { await db?.close(); });

async function finance() {
  return (await db.query<Record<string, string | number>>("select * from admin_dashboard_season_finance($1)", [season])).rows[0];
}

describe("season finance SQL", () => {
  it("counts cash once, includes inactive credit, and isolates seasons and program expenses", async () => {
    const row = await finance();
    expect(Number(row.signup_collected)).toBe(120);
    expect(Number(row.drop_in_collected)).toBe(24);
    expect(Number(row.total_collected)).toBe(144);
    expect(Number(row.total_expenses)).toBe(20);
    expect(Number(row.total_refunded)).toBe(12);
    expect(Number(row.club_balance)).toBe(112);
    expect(Number(row.total_player_credit)).toBe(25);
    expect(Number(row.total_waived)).toBe(48);
    expect(Number(row.net_club_balance)).toBe(87);
    expect(Number(row.player_count)).toBe(0);
  });

  it("uses current waiver values when edited or removed, without deducting waived cash", async () => {
    await db.exec("begin");
    try {
      await db.query("update player_season_payment_summary set waived_amount = 6.50 where player_id=$1 and season_id=$2", [player, season]);
      expect(Number((await finance()).total_waived)).toBe(6.5);
      expect(Number((await finance()).club_balance)).toBe(112);
      await db.query("update player_season_payment_summary set waived_amount=0 where season_id=$1", [season]);
      expect(Number((await finance()).total_waived)).toBe(0);
    } finally { await db.exec("rollback"); }
  });

  it("a refund reduces cash and credit equally, leaving net balance unchanged", async () => {
    await db.exec("begin");
    try {
      await db.query("insert into ledger_entries values ($1,$2,$3,'refund_paid',10.10)", [season, org, player]);
      await db.query("update player_season_payment_summary set credit_amount=14.90 where season_id=$1 and player_id=$2", [season, player]);
      const row = await finance();
      expect(Number(row.club_balance)).toBe(101.9);
      expect(Number(row.net_club_balance)).toBe(87);
    } finally { await db.exec("rollback"); }
  });

  it("allows negative net balances and returns zeros for an empty season", async () => {
    await db.exec("begin");
    try {
      await db.query("update player_season_payment_summary set credit_amount=200 where season_id=$1 and player_id=$2", [season, player]);
      expect(Number((await finance()).net_club_balance)).toBe(-88);
      await db.exec("delete from payments; delete from club_expenses; delete from ledger_entries; delete from player_season_payment_summary;");
      expect(Object.values(await finance()).every((value) => Number(value) === 0)).toBe(true);
    } finally { await db.exec("rollback"); }
  });

  it("rejects non-admin access and unknown seasons", async () => {
    await expect(db.query("select * from admin_dashboard_season_finance($1)", [player])).rejects.toThrow("Only an organization admin");
    await db.exec("set test.role='player'");
    try { await expect(finance()).rejects.toThrow("Only an organization admin"); }
    finally { await db.exec("set test.role='admin'"); }
  });
});

describe("public report season SQL", () => {
  it("selects active over a newer draft and scopes by tenant and program", async () => {
    expect((await db.query("select * from public_report_season('ou-soccer','football')")).rows).toEqual([{ season_id: season, season_name: "Summer" }]);
    expect((await db.query("select * from public_report_season('other','football')")).rows).toEqual([]);
    expect((await db.query("select * from public_report_season('ou-soccer','other')")).rows).toEqual([]);
  });

  it("falls back to the newest season and respects disabled public reports", async () => {
    await db.exec("begin");
    try {
      await db.exec("update seasons set status='archived'");
      expect((await db.query("select * from public_report_season()")).rows).toEqual([{ season_id: otherSeason, season_name: "Fall" }]);
      await db.exec("update organizations set public_reports_enabled=false");
      expect((await db.query("select * from public_report_season()")).rows).toEqual([]);
    } finally { await db.exec("rollback"); }
  });
});
