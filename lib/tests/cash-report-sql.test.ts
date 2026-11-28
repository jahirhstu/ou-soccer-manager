import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
let db: PGlite;
const org='11111111-1111-4111-8111-111111111111', program='22222222-2222-4222-8222-222222222222', season='33333333-3333-4333-8333-333333333333', winter='44444444-4444-4444-8444-444444444444';
beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create table programs(id uuid,organization_id uuid);
    create table seasons(id uuid,program_id uuid,organization_id uuid,name text);
    create table players(id uuid,display_name text);
    create table payments(id uuid default gen_random_uuid(),season_id uuid,organization_id uuid,player_id uuid,payment_date date,amount numeric,reference_note text,created_at timestamptz default now());
    create table club_expenses(id uuid default gen_random_uuid(),season_id uuid,program_id uuid,organization_id uuid,expense_date date,amount numeric,vendor text,category text,notes text,created_at timestamptz default now());
    create table ledger_entries(id uuid default gen_random_uuid(),season_id uuid,organization_id uuid,player_id uuid,type text,amount numeric,description text,refund_date date,created_at timestamptz default now());
    create table club_balance_transfers(id uuid default gen_random_uuid(),source_season_id uuid,destination_season_id uuid,program_id uuid,organization_id uuid,transfer_date date,amount numeric,note text,reverses_transfer_id uuid,created_at timestamptz default now());
    create function can_manage_program_finance(uuid) returns boolean language sql as $$ select coalesce(current_setting('test.allowed',true),'yes')<>'no'; $$;
    insert into programs values('${program}','${org}');
    insert into seasons values('${season}','${program}','${org}','Fall'),('${winter}','${program}','${org}','Winter');
    insert into players values('${org}','Jahid');
    insert into payments(season_id,organization_id,player_id,payment_date,amount) values('${season}','${org}','${org}','2026-10-31',500),('${season}','${org}','${org}','2026-11-01',200);
    insert into club_expenses(season_id,program_id,organization_id,expense_date,amount,category) values('${season}','${program}','${org}','2026-11-02',300,'food');`);
  await db.exec(readFileSync('supabase/migrations/119_club_cash_report.sql','utf8'));
},30000);
afterAll(async()=>{await db?.close();});
async function report(selected: string|null=null,from='2026-11-01',to='2026-11-30',page=1,size: number|null=25) {
  return (await db.query<{r:any}>('select admin_club_cash_report($1,$2,$3,$4,$5,$6) r',[program,from,to,selected,page,size])).rows[0].r;
}
async function changed(sql:string,check:()=>Promise<void>){await db.exec('begin');try{await db.exec(sql);await check();}finally{await db.exec('rollback');}}
describe('cash report SQL',()=>{
  it('matches the opening 500 / in 200 / out 300 example',async()=>{const r=await report();expect(r).toMatchObject({opening:500,money_in:200,money_out:300,closing:400,count:2});expect(r.rows.map((x:any)=>x.balance)).toEqual([700,400]);});
  it('uses inclusive transaction dates and carries opening through an empty range',async()=>{expect(await report(null,'2026-11-02','2026-11-02')).toMatchObject({opening:700,closing:400,count:1});expect(await report(null,'2026-12-01','2026-12-31')).toMatchObject({opening:400,closing:400,count:0,rows:[]});expect(await report(null,'2020-01-01','2020-01-01')).toMatchObject({opening:0,closing:0});});
  it('includes refunds and payment adjustments but ignores ledger payment mirrors and credit entries',async()=>{
    await changed(`insert into ledger_entries(season_id,organization_id,type,amount,refund_date) values('${season}','${org}','refund_paid',450,'2026-11-03'),('${season}','${org}','payment_received',200,'2026-11-03'),('${season}','${org}','credit_transferred_in',100,'2026-11-03'); insert into payments(season_id,organization_id,payment_date,amount) values('${season}','${org}','2026-11-04',-10);`,async()=>{const r=await report();expect(r).toMatchObject({closing:-60,money_out:760,count:4});expect(r.rows[3].particulars).toContain('Payment adjustment');});
  });
  it('uses Toronto creation date for legacy refunds',async()=>{await changed(`insert into ledger_entries(season_id,organization_id,type,amount,created_at) values('${season}','${org}','refund_paid',13,'2026-11-02T02:00:00Z');`,async()=>{const r=await report();const refund=r.rows.find((x:any)=>x.id.startsWith('refund:'));expect(refund.date).toBe('2026-11-01');expect(refund.description).toContain('creation date');expect(r.closing).toBe(387);});});
  it('counts transfers only for a selected season, with reversals cancelling',async()=>{
    await changed(`insert into club_balance_transfers(id,source_season_id,destination_season_id,program_id,organization_id,transfer_date,amount) values('${org}','${season}','${winter}','${program}','${org}','2026-11-03',100);`,async()=>{expect((await report()).closing).toBe(400);expect((await report(season)).closing).toBe(300);expect((await report(winter)).closing).toBe(100);await db.exec(`insert into club_balance_transfers(source_season_id,destination_season_id,program_id,organization_id,transfer_date,amount,reverses_transfer_id) values('${season}','${winter}','${program}','${org}','2026-11-04',-100,'${org}');`);expect((await report(season)).closing).toBe(400);expect((await report(winter)).closing).toBe(0);});
  });
  it('includes unassigned program expenses once and excludes other programs',async()=>{await changed(`insert into club_expenses(program_id,organization_id,expense_date,amount,category) values('${program}','${org}','2026-11-04',25,'food'),('${winter}','${org}','2026-11-04',999,'food');`,async()=>{expect((await report()).closing).toBe(375);expect((await report(season)).closing).toBe(375);});});
  it('keeps running balances and totals across pages and exports all rows',async()=>{await changed(`insert into payments(season_id,organization_id,payment_date,amount,created_at) select '${season}','${org}','2026-11-04',1,'2026-11-04T00:00:00Z'::timestamptz+i*interval '1 second' from generate_series(1,30) i;`,async()=>{const first=await report(null,undefined,undefined,1,10), second=await report(null,undefined,undefined,2,10),all=await report(null,undefined,undefined,1,null);expect(first.rows).toHaveLength(10);expect(second.rows[0].number).toBe(11);expect(second.rows[0].balance).toBe(first.rows[9].balance+1);expect(all.rows).toHaveLength(32);expect(all.closing).toBe(430);expect((await report(null,undefined,undefined,999,10)).page).toBe(4);});});
  it('rejects wrong seasons, invalid dates and unauthorized access',async()=>{await expect(report(org)).rejects.toThrow('Season does not belong');await expect(report(null,'2026-12-01','2026-11-01')).rejects.toThrow('valid From');await changed("set test.allowed='no'",async()=>{await expect(report()).rejects.toThrow('authorized program manager');});});
});
