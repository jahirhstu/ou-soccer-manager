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
const payload = (unresolved = false) => ({ parsed_json: { session: { date:'2026-11-29',startTime:'07:00',endTime:'09:00',location:'Bell Sensplex',pricePerSession:13 } }, draft: { needs_review: unresolved, rows:[{name:'Rafiul',player_id:unresolved?undefined:player,status:unresolved?'unresolved':'confirmed',order:0}] } });
async function save(finalize: boolean, review=false, content=payload()) {
  return (await db.query<{result:any}>('select signup_import_save($1,$2,$3,$4,$5,$6) result',[run.id,org,run.claim_token,JSON.stringify(content),finalize,review])).rows[0].result;
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
  for (const file of ['110_whatsapp_message_scheduler.sql','114_scheduled_signup_imports.sql','115_signup_import_session_details.sql']) await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
},30000);
beforeEach(async () => {
  await db.exec(`begin;select set_config('request.jwt.claim.sub','${admin}',true);
    insert into message_worker_connections(id,organization_id,token_hash,instance_id,lease_until) values('${worker}','${org}',encode(extensions.digest('${'a'.repeat(64)}','sha256'),'hex'),'${instance}',clock_timestamp()+interval '2 minutes');
    insert into message_destinations(id,organization_id,group_id,name) values('${dest}','${org}','soccer@g.us','Soccer');
    insert into signup_import_schedules(id,organization_id,program_id,season_id,destination_id,name,weekday,local_time,enabled,created_by,created_at) values('${schedule}','${org}','${program}','${season}','${dest}','Weekly',4,'20:00',true,'${admin}',clock_timestamp()-interval '8 days');`);
  run=await claim();
});
afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
it('creates a session and saves unresolved draft without writing attendance',async()=>{
  const saved=await save(false,false,payload(true));expect(saved.status).toBe('needs_review');expect(saved.session_id).toBeTruthy();
  expect((await db.query('select * from sessions')).rows).toHaveLength(1);
  expect((await db.query('select * from attendance')).rows).toHaveLength(0);
});
it('finalizes reviewed identities into the prepared session and is idempotent',async()=>{
  const draft=await save(false,false,payload(true));const result=await save(true,true);
  expect(result.session_id).toBe(draft.session_id);expect(result.status).toBe('imported');
  expect((await db.query<any>('select * from signup_import_attendance')).rows[0].run_id).toBe(run.id);
  expect((await save(true,true)).status).toBe('imported');
  expect((await db.query('select * from attendance')).rows).toHaveLength(1);
});
it('automatically imports a fully resolved roster and never creates payments',async()=>{
  const result=await save(true);expect(result.status).toBe('imported');
  const session=(await db.query<any>('select * from sessions')).rows[0];expect(Number(session.price_per_session)).toBe(13);
  expect(session.start_time).toBe('07:00:00');
});
it('claims a scheduled occurrence only once and safely recovers an expired claim',async()=>{
  expect(await claim(run.scheduled_at)).toBeNull();
  await db.exec(`update signup_import_runs set claim_until=clock_timestamp()-interval '1 second' where id='${run.id}'`);
  const recovered=await claim(run.scheduled_at);expect(recovered.id).toBe(run.id);expect(recovered.claim_token).not.toBe(run.claim_token);
  await expect(save(false)).rejects.toThrow('claim expired');
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
it('does not overwrite manually managed attendance',async()=>{
  const draft=await save(false);
  await db.exec(`insert into attendance(session_id,player_id,status) values('${draft.session_id}','${player}','confirmed')`);
  await expect(save(true,true)).rejects.toThrow('manual attendance');
});
it('manual edits relinquish import ownership',async()=>{
  const result=await save(true);
  await db.exec(`update attendance set status='waitlisted' where session_id='${result.session_id}'`);
  expect((await db.query('select * from signup_import_attendance')).rows).toHaveLength(0);
});
it('rolls back session creation when an invalid finalized roster is submitted',async()=>{
  await db.exec('savepoint invalid_roster');
  await expect(save(true,false,payload(true))).rejects.toThrow('Resolve the draft');
  await db.exec('rollback to savepoint invalid_roster');
  expect((await db.query('select * from sessions')).rows).toHaveLength(0);
});

it('reuses an existing scheduled session without replacing its metadata',async()=>{
  await db.exec(`insert into sessions(organization_id,program_id,season_id,session_date,name,status) values('${org}','${program}','${season}','2026-11-29','Manually named session','scheduled')`);
  const saved=await save(false);expect(saved.session_id).toBeTruthy();
  const rows=(await db.query<any>('select * from sessions')).rows;expect(rows).toHaveLength(1);expect(rows[0].name).toBe('Manually named session');
});
it('requires review when the target date has multiple sessions',async()=>{
  await db.exec(`insert into sessions(organization_id,program_id,season_id,session_date,status) values('${org}','${program}','${season}','2026-11-29','scheduled'),('${org}','${program}','${season}','2026-11-29','scheduled')`);
  await expect(save(false)).rejects.toThrow('Multiple sessions');
});
it('blocks automatic writes after a schedule is disabled',async()=>{
  await db.exec(`update signup_import_schedules set enabled=false where id='${schedule}'`);
  await expect(save(true)).rejects.toThrow('schedule changed');
});
it('blocks an old worker instance from committing after losing its lease',async()=>{
  await db.exec(`update message_worker_connections set lease_until=clock_timestamp()-interval '1 second' where id='${worker}'`);
  await expect(save(true)).rejects.toThrow('Worker lease lost');
});
it('allows a reviewed rerun to replace attendance owned by the same schedule',async()=>{
  await save(true);
  run=await claim(new Date(Date.now()-500).toISOString());
  await save(false);
  const content=payload();content.draft.rows[0].status='waitlisted';
  content.draft.rows.push({name:'Another player',player_id:'90000000-0000-4000-8000-000000000002',status:'confirmed',order:1});
  await db.exec(`insert into players values('90000000-0000-4000-8000-000000000002','${org}')`);
  const saved=await save(true,true,content);expect(saved.status).toBe('imported');
  const rows=(await db.query<any>('select * from attendance order by player_id')).rows;expect(rows).toHaveLength(2);expect(rows[0].status).toBe('waitlisted');expect((await db.query<any>('select * from signup_import_attendance')).rows.every(r=>r.run_id===run.id)).toBe(true);
});

it('names a new session November 29th and reuses a playground embedded in the full address',async()=>{
  await db.exec(`insert into playgrounds(id,organization_id,name) values('${dest}','${org}','Bell Sensplex Stittsville'),('${worker}','${org}','Bells Sensplex')`);
  const content=payload();content.parsed_json.session.location='Bell Sensplex 1565 Maple Grove Rd, Stittsville';
  await save(false,false,content);
  const session=(await db.query<any>('select * from sessions')).rows[0];
  expect(session.name).toBe('November 29th');expect(session.playground_id).toBe(dest);expect(session.location).toBe('Bell Sensplex Stittsville');
  expect((await db.query('select * from playgrounds')).rows).toHaveLength(2);
});
it('repairs a generic prepared draft name and missing playground link during review',async()=>{
  await db.exec(`insert into playgrounds(id,organization_id,name) values('${dest}','${org}','Bell Sensplex')`);
  const draft=await save(false);
  await db.exec(`update sessions set name='Weekly soccer',playground_id=null,location='Bell Sensplex 1565 Maple Grove Rd' where id='${draft.session_id}'`);
  await save(false,true);
  const session=(await db.query<any>('select * from sessions')).rows[0];expect(session.name).toBe('November 29th');expect(session.playground_id).toBe(dest);
});
it('does not guess between multiple existing playgrounds or create one on no match',async()=>{
  await db.exec(`insert into playgrounds(organization_id,name) values('${org}','Bell Sensplex'),('${org}','Bell Sensplex Stittsville')`);
  const content=payload();content.parsed_json.session.location='Bell Sensplex 1565 Maple Grove Rd, Stittsville';await save(false,false,content);
  expect((await db.query<any>('select * from sessions')).rows[0].playground_id).toBeNull();expect((await db.query('select * from playgrounds')).rows).toHaveLength(2);
});
it('never matches another organization playground',async()=>{
  await db.exec(`insert into playgrounds(organization_id,name) values('${other}','Bell Sensplex')`);
  await save(false);expect((await db.query<any>('select * from sessions')).rows[0].playground_id).toBeNull();
});
