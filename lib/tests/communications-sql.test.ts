import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { afterAll, beforeAll, beforeEach, afterEach, expect, it } from 'vitest';
let db:PGlite;
const org='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const admin='20000000-0000-4000-8000-000000000001',worker='30000000-0000-4000-8000-000000000001',instance='40000000-0000-4000-8000-000000000001';
const destination='50000000-0000-4000-8000-000000000001',schedule='60000000-0000-4000-8000-000000000001',execution='70000000-0000-4000-8000-000000000001';
const token='a'.repeat(64);
async function rpc(operation:string,data:unknown={},who=instance){const result=await db.query<{result:any}>('select message_worker($1,$2,$3,$4,$5) result',[worker,token,who,operation,JSON.stringify(data)]);return result.rows[0].result;}
beforeAll(async()=>{
  db=new PGlite({extensions:{pgcrypto}});
  await db.exec(`create role anon;create role authenticated;create schema auth;create schema extensions;create extension pgcrypto with schema extensions;
    create table organizations(id uuid primary key);insert into organizations values('${org}'),('${other}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function organization_role(oid uuid) returns text language sql stable as $$select case when auth.uid()='${admin}'::uuid and oid='${org}'::uuid then 'admin' else 'player' end$$;
    grant usage on schema auth,public to anon,authenticated;`);
  await db.exec(readFileSync('supabase/migrations/110_whatsapp_message_scheduler.sql','utf8'));
},30000);
beforeEach(async()=>{
  await db.exec(`begin;select set_config('request.jwt.claim.sub','${admin}',true);
    insert into message_worker_connections(id,organization_id,token_hash,automatic_enabled) values('${worker}','${org}',encode(extensions.digest('${token}','sha256'),'hex'),true);
    insert into message_destinations(id,organization_id,group_id,name) values('${destination}','${org}','group@g.us','Soccer');
    insert into message_schedules(id,organization_id,name,body,destination_id,frequency,enabled) values('${schedule}','${org}','Weekly','Hello','${destination}','weekly',true);
    insert into message_executions(id,organization_id,schedule_id,schedule_revision,scheduled_at,body,group_id) values('${execution}','${org}','${schedule}',1,clock_timestamp(),'Hello','group@g.us');`);
  await rpc('heartbeat',{state:'ready',compatible:true});
});
afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
it('claims exactly once and persists acknowledged latency',async()=>{
  await rpc('prepare',{id:execution});const first=await rpc('authorize',{id:execution});expect(first.attempt_id).toBeTruthy();
  expect(await rpc('authorize',{id:execution})).toBeNull();
  await rpc('result',{id:execution,attempt_id:first.attempt_id,status:'sent',dispatch_at:first.scheduled_at,acknowledgement_at:new Date().toISOString(),provider_message_id:'message'});
  const row=(await db.query<any>('select * from message_executions')).rows[0];expect(row.status).toBe('sent');expect(row.latency_ms).toBe(0);
});
it('rejects another worker instance while the lease is live',async()=>{
  await expect(rpc('heartbeat',{state:'ready',compatible:true},'40000000-0000-4000-8000-000000000002')).rejects.toThrow('already active');
});
it('never reclaims an uncertain dispatch after restart',async()=>{
  await rpc('prepare',{id:execution});await rpc('authorize',{id:execution});
  await db.exec("update message_worker_connections set lease_until=now()-interval '1 second'");
  await rpc('heartbeat',{state:'ready',compatible:true},'40000000-0000-4000-8000-000000000002');
  const row=(await db.query<any>('select status,phase from message_executions')).rows[0];expect(row).toEqual({status:'unknown',phase:'complete'});
});
it('marks offline occurrences missed and preserves unique execution keys',async()=>{
  await db.exec("update message_executions set scheduled_at=now()-interval '10 seconds'");expect(await rpc('due')).toEqual([]);
  expect((await db.query<any>('select status from message_executions')).rows[0].status).toBe('missed');
  await expect(db.exec(`insert into message_executions(organization_id,schedule_id,scheduled_at,body,group_id) select organization_id,schedule_id,scheduled_at,body,group_id from message_executions`)).rejects.toThrow('duplicate');
});
it('checks cancellation and schedule revision at final authorization',async()=>{
  await rpc('prepare',{id:execution});await db.exec(`update message_schedules set enabled=false where id='${schedule}'`);
  expect(await rpc('authorize',{id:execution})).toBeNull();
  expect((await db.query<any>('select status from message_executions')).rows[0].status).toBe('cancelled');
});
it('blocks cross-organization destinations',async()=>{
  await expect(db.exec(`insert into message_schedules(organization_id,name,body,destination_id,frequency) values('${other}','Bad','Hello','${destination}','daily')`)).rejects.toThrow('foreign key');
});
it('RLS hides configuration and history from players and other organizations',async()=>{
  await db.exec(`select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000099',true);set local role authenticated;`);
  expect((await db.query('select * from message_schedules')).rows).toEqual([]);
  expect((await db.query('select * from message_executions')).rows).toEqual([]);
  await expect(db.exec(`insert into message_templates(organization_id,name,body) values('${org}','Unauthorized','No')`)).rejects.toThrow('row-level security');
});
it('keeps worker tokens inaccessible and execution writes worker-only',async()=>{
  await db.exec('set local role authenticated');
  await expect(db.exec('select token_hash from message_worker_connections')).rejects.toThrow('permission denied');
});
it('rejects invalid or revoked worker credentials',async()=>{
  await db.exec("update message_worker_connections set token_hash='revoked'");
  await expect(rpc('due')).rejects.toThrow('Invalid worker credential');
});
it('test messages expire rather than being delivered after an outage',async()=>{
  await db.exec(`update message_executions set is_test=true,expires_at=now()-interval '1 second'`);
  expect(await rpc('due')).toEqual([]);
});
it('rejects a null token even with a valid worker ID',async()=>{
  await expect(db.query('select message_worker($1,null,$2,\'heartbeat\',\'{}\')',[worker,instance])).rejects.toThrow('Invalid worker credential');
});
it('never authorizes early dispatch',async()=>{
  await db.exec("update message_executions set scheduled_at=now()+interval '30 seconds'");await rpc('prepare',{id:execution});
  expect(await rpc('authorize',{id:execution})).toBeNull();
});
it('recovers prepared work but not dispatch intent after a worker restart',async()=>{
  await rpc('prepare',{id:execution});
  await db.exec("update message_worker_connections set lease_until=now()-interval '1 second'");
  const replacement='40000000-0000-4000-8000-000000000002';await rpc('heartbeat',{state:'ready',compatible:true},replacement);
  expect((await db.query<any>('select phase from message_executions')).rows[0].phase).toBe('queued');
  await rpc('prepare',{id:execution},replacement);expect((await rpc('authorize',{id:execution},replacement)).attempt_id).toBeTruthy();
});
it('marks a timed-out final authorization unknown without reopening the attempt',async()=>{
  await rpc('prepare',{id:execution});await rpc('authorize',{id:execution});
  await db.exec("update message_executions set authorized_at=now()-interval '61 seconds'");
  expect(await rpc('due')).toEqual([]);expect((await db.query<any>('select status from message_executions')).rows[0].status).toBe('unknown');
  expect(await rpc('prepare',{id:execution})).toBeNull();
});
it('requires a matching attempt to write delivery outcomes',async()=>{
  await rpc('prepare',{id:execution});await rpc('authorize',{id:execution});
  await expect(rpc('result',{id:execution,attempt_id:'80000000-0000-4000-8000-000000000001',status:'sent'})).rejects.toThrow('Invalid dispatch attempt');
});
it('blocks dispatch when the organization automation switch is off',async()=>{
  await rpc('prepare',{id:execution});await db.exec('update message_worker_connections set automatic_enabled=false');
  expect(await rpc('authorize',{id:execution})).toBeNull();
});
it('prevents authenticated admins from updating execution results directly',async()=>{
  await db.exec('set local role authenticated');
  await expect(db.exec("update message_executions set status='sent'")).rejects.toThrow('permission denied');
});
it('cancels stale schedule revisions at the final authorization boundary',async()=>{
  await rpc('prepare',{id:execution});await db.exec("update message_schedules set body='Edited'");
  expect(await rpc('authorize',{id:execution})).toBeNull();
});
it('syncs groups, exposes schedules, and materializes a future execution',async()=>{
  await rpc('sync',{groups:[{id:'group@g.us',name:'Soccer'}]});
  const packet=await rpc('scan');expect(packet.schedules).toHaveLength(1);expect(packet.destinations).toHaveLength(1);
  await rpc('materialize',{schedule_id:schedule,revision:1,scheduled_at:new Date(Date.now()+60000).toISOString(),body:'Prepared message'});
  expect((await db.query<any>('select count(*)::int count from message_executions')).rows[0].count).toBe(2);
  await rpc('scanned',{at:new Date().toISOString()});
  expect((await rpc('scan')).last_scan_at).toBeTruthy();
});
it('records an execution missed during an outage without authorizing a send',async()=>{
  await rpc('materialize',{schedule_id:schedule,revision:1,scheduled_at:'2026-01-01T00:00:00Z',body:'Past message'});
  const row=(await db.query<any>("select id,status from message_executions where scheduled_at='2026-01-01T00:00:00Z'")).rows[0];
  expect(row.status).toBe('missed');expect(await rpc('authorize',{id:row.id})).toBeNull();
});
