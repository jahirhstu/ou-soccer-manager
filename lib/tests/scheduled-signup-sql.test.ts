import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
let db: PGlite;
const org='10000000-0000-4000-8000-000000000001', other='10000000-0000-4000-8000-000000000002';
const admin='20000000-0000-4000-8000-000000000001', program='30000000-0000-4000-8000-000000000001', season='40000000-0000-4000-8000-000000000001';
const dest='50000000-0000-4000-8000-000000000001', worker='60000000-0000-4000-8000-000000000001', instance='70000000-0000-4000-8000-000000000001';
const schedule='80000000-0000-4000-8000-000000000001', player='90000000-0000-4000-8000-000000000001';
let run: any;
async function claim(at = new Date(Date.now()-1000).toISOString()) {
  return (await db.query<{ result: any }>('select signup_import_claim($1,$2,$3,$4,$5) result', [org,schedule,instance,at,JSON.stringify({target_date:'2026-11-29',from:'2026-11-24T02:00:00Z',until:'2026-11-27T01:00:00Z'})])).rows[0].result;
}
beforeAll(async () => {
  db=new PGlite({extensions:{pgcrypto}});
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema extensions;create extension pgcrypto with schema extensions;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function organization_role(oid uuid) returns text language sql stable as $$select case when auth.uid()='${admin}'::uuid and oid='${org}'::uuid then 'admin' else 'player' end$$;
    grant usage on schema auth,public to anon,authenticated;
    create table organizations(id uuid primary key);insert into organizations values('${org}'),('${other}');
    create table profiles(id uuid primary key);insert into profiles values('${admin}');
    create table programs(id uuid primary key,status text);insert into programs values('${program}','active');
    create table program_modules(program_id uuid,module_key text,enabled boolean);
    create table seasons(id uuid primary key,organization_id uuid,program_id uuid);insert into seasons values('${season}','${org}','${program}');
    create table players(id uuid primary key,organization_id uuid);insert into players values('${player}','${org}');
    create table playgrounds(id uuid primary key default gen_random_uuid(),organization_id uuid,name text);
    create table sessions(id uuid primary key default gen_random_uuid(),organization_id uuid,program_id uuid,season_id uuid,session_date date,name text,playground_id uuid references playgrounds(id),location text,start_time time,end_time time,price_per_session numeric,status text,created_by uuid,notes text);
    create table attendance(session_id uuid references sessions(id),player_id uuid references players(id),status text,created_by uuid,notes text,primary key(session_id,player_id));`);
  for (const file of ['110_whatsapp_message_scheduler.sql','114_scheduled_signup_imports.sql','115_signup_import_session_details.sql','116_shared_signup_import.sql']) await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
},30000);
beforeEach(async () => {
  await db.exec(`begin;select set_config('request.jwt.claim.sub','${admin}',true);
    insert into message_worker_connections(id,organization_id,token_hash,instance_id,lease_until) values('${worker}','${org}',encode(extensions.digest('${'a'.repeat(64)}','sha256'),'hex'),'${instance}',clock_timestamp()+interval '2 minutes');
    insert into message_destinations(id,organization_id,group_id,name) values('${dest}','${org}','soccer@g.us','Soccer');
    insert into signup_import_schedules(id,organization_id,program_id,season_id,destination_id,name,weekday,local_time,enabled,created_by,created_at) values('${schedule}','${org}','${program}','${season}','${dest}','Weekly',4,'20:00',true,'${admin}',clock_timestamp()-interval '8 days');`);
  run=await claim();
});
afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
it('claims a scheduled occurrence only once and safely recovers an expired claim',async()=>{
  expect(await claim(run.scheduled_at)).toBeNull();
  await db.exec(`update signup_import_runs set claim_until=clock_timestamp()-interval '1 second' where id='${run.id}'`);
  const recovered=await claim(run.scheduled_at);expect(recovered.id).toBe(run.id);expect(recovered.claim_token).not.toBe(run.claim_token);
  expect(recovered.status).toBe('reading');
});
it('marks occurrences outside recovery window missed',async()=>{
  expect(await claim(new Date(Date.now()-7200000).toISOString())).toBeNull();
  expect((await db.query<any>("select * from signup_import_runs where status='missed'")).rows).toHaveLength(1);
});
it('rejects a forged worker or another instance',async()=>{
  expect((await db.query<any>('select signup_import_worker_context($1,$2,$3) org',[worker,'a'.repeat(64),instance])).rows[0].org).toBe(org);
  await expect(db.query('select signup_import_worker_context($1,$2,$3)',[worker,'b'.repeat(64),instance])).rejects.toThrow('Invalid worker');
});
it('rejects invalid scope and prevents non-admin history reads',async()=>{
  await db.exec(`select set_config('request.jwt.claim.sub','${player}',true);set local role authenticated;`);
  expect((await db.query('select * from signup_import_runs')).rows).toHaveLength(0);
  await expect(db.exec('select signup_import_worker_context(null,null,null)')).rejects.toThrow('permission denied');
});
it('removes the separate import writer and ownership machinery',async()=>{
  const result=(await db.query<any>(`select to_regprocedure('public.signup_import_save(uuid,uuid,uuid,jsonb,boolean,boolean)') is null writer_removed,to_regclass('public.signup_import_attendance') is null ownership_removed`)).rows[0];
  expect(result).toEqual({writer_removed:true,ownership_removed:true});
});
