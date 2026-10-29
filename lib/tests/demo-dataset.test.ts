import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { accounts, buildDemoDataset, demoId, type AccountIds } from "../../scripts/demo/dataset";

let db: PGlite;
beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions;
    create extension pgcrypto with schema extensions;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', email_confirmed_at timestamptz, updated_at timestamptz);
    create table auth.identities(user_id uuid, provider text, provider_id text, identity_data jsonb, updated_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select current_user::text $$;
    create publication supabase_realtime;
    grant usage on schema public, auth to anon, authenticated;
    alter default privileges in schema public grant all on tables to authenticated, service_role;
    alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;
  `);
  for (const file of readdirSync("supabase/migrations").filter(f=>f.endsWith(".sql")).sort()) await db.exec(readFileSync(`supabase/migrations/${file}`,"utf8"));
  const ids = Object.fromEntries(accounts.map(key=>[key,demoId(`account:${key}`)])) as AccountIds;
  for (const key of accounts) await db.query("insert into auth.users(id,email) values ($1,$2)",[ids[key],`${key}@demo.example.test`]);
  await db.exec("begin");
  const dataset = buildDemoDataset(ids,"2026-10-24");
  for (const statement of dataset.sql.split(";\n")) {
    try { await db.exec(statement); }
    catch(error) { throw new Error(`${(error as Error).message}\nStatement: ${statement}`); }
  }
  await db.exec("commit");
},120000);
afterAll(async()=>{await db?.close();});

it("seeds every program with seasons, sessions, results and notifications",async()=>{
  const result=await db.query<{seasons:number;sessions:number;matches:number;notifications:number}>(`select
    (select count(*)::int from seasons) seasons, (select count(*)::int from sessions) sessions,
    (select count(*)::int from session_matches) matches, (select count(*)::int from notifications) notifications`);
  expect(result.rows[0]).toEqual({seasons:24,sessions:144,matches:360,notifications:128});
});

it("keeps credits, debts, refunds and waivers distinct",async()=>{
  const season=demoId("northstar-demo:soccer:season:1");
  const credit=async(n:number)=>{
    const result=await db.query<{credit_amount:string}>("select credit_amount from player_season_payment_summary where season_id=$1 and player_id=$2",[season,demoId(`northstar-demo:player:${n}`)]);
    return result.rows[0].credit_amount;
  };
  expect(await credit(0)).toBe("84.00");
  expect(await credit(1)).toBe("0.00");
  expect(await credit(4)).toBe("64.00");
  expect(await credit(5)).toBe("108.00");
  expect(await credit(9)).toBe("72.00");
  expect(await credit(11)).toBe("0.00");
  expect(await credit(13)).toBe("99.50");
  expect(await credit(14)).toBe("78.75");
  expect(await credit(19)).toBe("72.00");
  expect(await credit(20)).toBe("0.00");
});

it("matches dashboard credit to player balances without duplicate counting",async()=>{
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[demoId("account:owner")]);
    const result=await db.query<{matches:boolean}>(`select f.total_player_credit =
      (select sum(greatest(credit_amount,0)) from player_season_payment_summary where season_id=s.id) matches
      from seasons s cross join lateral admin_dashboard_season_finance(s.id) f
      where s.program_id=$1`,[demoId("northstar-demo:soccer")]);
    expect(result.rows).toHaveLength(3);
    expect(result.rows.every(r=>r.matches)).toBe(true);
  } finally { await db.exec("rollback"); }
});

it("accepts notifications once and keeps unread messages unpaid",async()=>{
  const result=await db.query<{read:number;unread:number}>("select count(*) filter(where read_at is not null)::int read,count(*) filter(where read_at is null)::int unread from notifications");
  expect(result.rows[0]).toEqual({read:16,unread:112});
});

it("scopes public data and hides Riverside financial values",async()=>{
  const result=await db.query<{credit_amount:string|null;total_paid_amount:string|null}>("select * from scoped_public_player_report('riverside-demo','soccer')");
  expect(result.rows.length).toBeGreaterThan(0);
  expect(result.rows.every(r=>r.credit_amount===null&&r.total_paid_amount===null)).toBe(true);
  expect((await db.query("select * from scoped_public_player_report('northstar-demo','technical-activity')")).rows).toHaveLength(0);
});

it("restricts a soccer manager to their program",async()=>{
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[demoId("account:soccer-manager")]);
    await db.exec("set local role authenticated");
    const result=await db.query<{program_id:string}>("select distinct program_id from payments");
    expect(result.rows).toEqual([{program_id:demoId("northstar-demo:soccer")}]);
  } finally { await db.exec("rollback"); }
});

it("populates played match scores from goals and leaves future fixtures unplayed",async()=>{
  const result=await db.query<{played:number;scored:number;scheduled:number}>(`select
    count(*) filter(where result_status='played')::int played,
    count(*) filter(where result_status='played' and team_a_score+team_b_score>0)::int scored,
    count(*) filter(where result_status='scheduled')::int scheduled from session_matches`);
  expect(result.rows[0]).toEqual({played:210,scored:210,scheduled:150});
});
