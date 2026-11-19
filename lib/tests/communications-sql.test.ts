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
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema extensions;create extension pgcrypto with schema extensions;
    create table organizations(id uuid primary key);insert into organizations values('${org}'),('${other}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function organization_role(oid uuid) returns text language sql stable as $$select case when auth.uid()='${admin}'::uuid and oid='${org}'::uuid then 'admin' else 'player' end$$;
    grant usage on schema auth,public to anon,authenticated;`);
  await db.exec(readFileSync('supabase/migrations/110_whatsapp_message_scheduler.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/111_efficient_whatsapp_coordination.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/112_schedule_aware_whatsapp_worker.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/113_whatsapp_email_alerts.sql','utf8'));
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

async function coordinate(data:unknown={},who=instance){return(await db.query<{result:any}>('select message_worker_coordinate($1,$2,$3,$4) result',[worker,token,who,JSON.stringify({state:'ready',compatible:true,...data as object})])).rows[0].result;}
it('coordinates a 90-second lease and omits unchanged snapshots',async()=>{
  const first=await coordinate();expect(first.configuration.schedules).toHaveLength(1);expect(first.executions).toHaveLength(1);
  const second=await coordinate({configuration_revision:first.configuration_revision,work_revision:first.work_revision});
  expect(second.configuration).toBeNull();expect(second.executions).toBeNull();
  const row=(await db.query<any>('select heartbeat_interval_seconds,extract(epoch from lease_until-heartbeat_at)::int lease from message_worker_connections')).rows[0];
  expect(row.heartbeat_interval_seconds).toBe(30);expect(row.lease).toBe(90);
});
it('detects schedule edits and new test executions through version changes',async()=>{
  const first=await coordinate();await db.exec("update message_schedules set body='Changed'");
  const second=await coordinate({configuration_revision:first.configuration_revision,work_revision:first.work_revision});expect(second.configuration.schedules[0].body).toBe('Changed');
  await db.exec(`insert into message_executions(organization_id,body,group_id,scheduled_at,is_test,expires_at) values('${org}','Test','group@g.us',now(),true,now()+interval '60 seconds')`);
  const third=await coordinate({configuration_revision:second.configuration_revision,work_revision:second.work_revision});expect(third.executions).toHaveLength(2);
});
it('batch materialization is atomic and does not duplicate executions',async()=>{
  const first=await coordinate();const data={configuration_revision:first.configuration_revision,items:[{schedule_id:schedule,revision:1,scheduled_at:new Date(Date.now()+60000).toISOString(),body:'Future'}],scanned_at:new Date().toISOString()};
  for(let n=0;n<2;n++)await db.query('select message_worker_materialize_batch($1,$2,$3,$4)',[worker,token,instance,JSON.stringify(data)]);
  expect((await db.query<any>('select count(*)::int n from message_executions')).rows[0].n).toBe(2);
});
it('rejects a batch calculated before an administrator changed configuration',async()=>{
  const first=await coordinate();await db.exec("update message_schedules set enabled=false");
  await expect(db.query('select message_worker_materialize_batch($1,$2,$3,$4)',[worker,token,instance,JSON.stringify({configuration_revision:first.configuration_revision,items:[]})])).rejects.toThrow('Configuration changed');
});
it('retains fresh final authorization and releases ownership cleanly',async()=>{
  await coordinate();await rpc('prepare',{id:execution});expect((await rpc('authorize',{id:execution})).attempt_id).toBeTruthy();
  await coordinate({release:true});expect((await db.query<any>("select lease_until<=clock_timestamp() released from message_worker_connections")).rows[0].released).toBe(true);
  expect((await coordinate({},'40000000-0000-4000-8000-000000000002')).fence).toBeTruthy();
  expect((await db.query<any>('select status from message_executions')).rows[0].status).toBe('unknown');
});
it('uses negotiated liveness for tests and supports the legacy worker during rollback',async()=>{
  await coordinate();await db.exec("update message_worker_connections set heartbeat_at=now()-interval '45 seconds'");
  await db.query("select message_admin($1,'test',$2)",[org,JSON.stringify({destination_id:destination,body:'Confirmed test'})]);
  await rpc('heartbeat',{state:'ready',compatible:true});expect((await db.query<any>('select heartbeat_interval_seconds from message_worker_connections')).rows[0].heartbeat_interval_seconds).toBe(10);
});
it('queues an authorized on-demand group refresh',async()=>{
  await db.query('select message_request_group_refresh($1)',[org]);expect((await coordinate()).commands[0].command).toBe('refresh_groups');
});
it('does not let anonymous callers bypass the new worker authentication',async()=>{
  await expect(db.query("select message_worker_coordinate($1,null,$2,'{}')",[worker,instance])).rejects.toThrow('Invalid worker credential');
});

it('negotiates hourly idle check-ins with a 65-minute lease and prevents a competing sender',async()=>{
  const first=await coordinate({mode:'idle',next_check_at:new Date(Date.now()+3600000).toISOString()});
  const row=(await db.query<any>('select worker_mode,state,heartbeat_interval_seconds,extract(epoch from lease_until-heartbeat_at)::int lease from message_worker_connections')).rows[0];
  expect(row).toEqual({worker_mode:'idle',state:'idle',heartbeat_interval_seconds:3600,lease:3900});
  expect(first.configuration).toBeTruthy();
  await expect(coordinate({},'40000000-0000-4000-8000-000000000002')).rejects.toThrow('already active');
});
it('permits idle automation activation but rejects tests until WhatsApp is active',async()=>{
  await coordinate({mode:'idle'});
  await db.query("select message_admin($1,'automation',$2)",[org,JSON.stringify({enabled:true})]);
  await expect(db.query("select message_admin($1,'test',$2)",[org,JSON.stringify({destination_id:destination,body:'Test'})])).rejects.toThrow('Connected worker');
});
it('returns to the active lease on wake and to legacy liveness on rollback',async()=>{
  await coordinate({mode:'idle'});await coordinate();
  let row=(await db.query<any>('select worker_mode,heartbeat_interval_seconds,extract(epoch from lease_until-heartbeat_at)::int lease from message_worker_connections')).rows[0];
  expect(row).toEqual({worker_mode:'active',heartbeat_interval_seconds:30,lease:90});
  await coordinate({mode:'idle'});await rpc('heartbeat',{state:'ready',compatible:true});
  row=(await db.query<any>('select worker_mode,heartbeat_interval_seconds from message_worker_connections')).rows[0];expect(row).toEqual({worker_mode:'active',heartbeat_interval_seconds:10});
});
it('acknowledges accepted configuration after batch materialization and exposes later edits as pending',async()=>{
  const packet=await coordinate({mode:'idle'});
  await db.query('select message_worker_materialize_batch($1,$2,$3,$4)',[worker,token,instance,JSON.stringify({configuration_revision:packet.configuration_revision,items:[]})]);
  let status=(await db.query<any>("select message_admin($1,'status') result",[org])).rows[0].result;
  expect(status.acknowledged_configuration_revision).toBe(status.configuration_revision);
  await db.exec("update message_schedules set body='New content'");
  status=(await db.query<any>("select message_admin($1,'status') result",[org])).rows[0].result;
  expect(status.acknowledged_configuration_revision).not.toBe(status.configuration_revision);
});
it('releases an idle lease for an immediate clean restart and rejects overdue idle activation',async()=>{
  await coordinate({mode:'idle'});await coordinate({release:true});
  await coordinate({mode:'idle'},'40000000-0000-4000-8000-000000000002');
  await db.exec("update message_worker_connections set next_check_at=now()-interval '6 minutes'");
  await expect(db.query("select message_admin($1,'automation',$2)",[org,JSON.stringify({enabled:true})])).rejects.toThrow('compatible connected worker');
});

async function rejectAlertSql(run:()=>Promise<unknown>,message:string){await db.exec('savepoint expected_alert_error');await expect(run()).rejects.toThrow(message);await db.exec('rollback to savepoint expected_alert_error');}
async function enableAlerts(){
  await db.query("select message_alert_admin($1,'save',$2)",[org,JSON.stringify({recipient:'admin@example.com'})]);
  await db.exec("update message_alert_settings set test_succeeded_at=clock_timestamp(),enabled=true");
}
async function alertReport(events:unknown[],credential:string|null=token){return(await db.query<any>('select message_alert_report($1,$2,$3) result',[worker,credential,JSON.stringify(events)])).rows[0].result;}
it('requires a tested recipient and disables alerts when the recipient changes',async()=>{
  await db.query("select message_alert_admin($1,'save',$2)",[org,JSON.stringify({recipient:'admin@example.com'})]);
  await rejectAlertSql(()=>db.query("select message_alert_admin($1,'enable','{\"enabled\":true}')",[org]),'successful test');
  await db.exec('update message_alert_settings set test_succeeded_at=now(),enabled=true');
  await alertReport([{category:'connection',failed:true}]);
  await db.query("select message_alert_admin($1,'save',$2)",[org,JSON.stringify({recipient:'new@example.com'})]);
  const s=(await db.query<any>('select * from message_alert_settings')).rows[0];expect(s.enabled).toBe(false);expect(s.test_succeeded_at).toBeNull();
  expect((await db.query<any>('select status from message_alert_outbox')).rows[0].status).toBe('cancelled');
  expect((await db.query<any>('select resolved_at from message_alert_incidents')).rows[0].resolved_at).toBeTruthy();
});
it('deduplicates repeated failures across restarts and queues exactly one recovery',async()=>{
  await enableAlerts();
  for(let i=0;i<3;i++)await alertReport([{category:'connection',failed:true}]);
  for(let i=0;i<3;i++)await alertReport([{category:'connection',failed:false}]);
  expect((await db.query<any>('select kind from message_alert_outbox order by created_at')).rows.map(r=>r.kind)).toEqual(['failure','recovery']);
  await alertReport([{category:'connection',failed:true}]);expect((await db.query('select * from message_alert_incidents')).rows).toHaveLength(2);
});
it('does not persist incident emails while alerts are disabled and validates worker credentials',async()=>{
  await alertReport([{category:'connection',failed:true}]);expect((await db.query('select * from message_alert_outbox')).rows).toHaveLength(0);
  await rejectAlertSql(()=>alertReport([],null),'Invalid worker credential');
  await rejectAlertSql(()=>alertReport([{category:'unknown',failed:true}]),'Invalid alert category');
  await rejectAlertSql(()=>alertReport([{category:'connection'}]),'Invalid alert state');
});
it('monitors active and idle allowances without alerting for intentional suspension',async()=>{
  await enableAlerts();await coordinate({mode:'idle',next_check_at:new Date(Date.now()+3600000).toISOString()});
  await db.query('select message_alert_monitor()');expect((await db.query('select * from message_alert_incidents')).rows).toHaveLength(0);
  await db.exec("update message_worker_connections set next_check_at=now()-interval '6 minutes'");await db.query('select message_alert_monitor()');
  expect((await db.query<any>('select category from message_alert_incidents')).rows[0].category).toBe('worker_overdue');
  await coordinate();await db.query('select message_alert_monitor()');
  expect((await db.query<any>('select resolved_at from message_alert_incidents')).rows[0].resolved_at).toBeTruthy();
  await db.exec("update message_worker_connections set heartbeat_at=now()-interval '91 seconds'");await db.query('select message_alert_monitor()');
  expect((await db.query<any>('select count(*)::int n from message_alert_incidents where resolved_at is null')).rows[0].n).toBe(1);
});
it('allows normal initialization, then detects connection timeout and ignores explicit logout',async()=>{
  await enableAlerts();await coordinate({state:'starting'});await db.query('select message_alert_monitor()');
  expect((await db.query('select * from message_alert_incidents')).rows).toHaveLength(0);
  await db.exec("update message_worker_connections set state_changed_at=now()-interval '121 seconds'");await db.query('select message_alert_monitor()');
  expect((await db.query<any>('select category from message_alert_incidents')).rows[0].category).toBe('connection');
  await coordinate({state:'logged_out'});await db.query('select message_alert_monitor()');
  expect((await db.query('select * from message_alert_incidents')).rows).toHaveLength(1);
});
it('queues uncertain results in the result transaction and resolves only after confirmed delivery',async()=>{
  await enableAlerts();await rpc('prepare',{id:execution});const attempt=await rpc('authorize',{id:execution});
  await rpc('result',{id:execution,attempt_id:attempt.attempt_id,status:'unknown',dispatch_at:new Date().toISOString()});
  expect((await db.query<any>('select category from message_alert_incidents')).rows[0].category).toBe('delivery_unknown');
  await rpc('result',{id:execution,attempt_id:attempt.attempt_id,status:'unknown'});expect((await db.query('select * from message_alert_outbox')).rows).toHaveLength(1);
  await rpc('result',{id:execution,attempt_id:attempt.attempt_id,status:'sent'});expect((await db.query('select * from message_alert_outbox')).rows).toHaveLength(2);
});
it('claims emails once, freezes provider payload, and sends recovery only after failure acceptance',async()=>{
  await enableAlerts();await alertReport([{category:'connection',failed:true},{category:'connection',failed:false}]);
  const first=(await db.query<any>('select message_alert_claim() result')).rows[0].result;expect(first).toHaveLength(1);expect(first[0].kind).toBe('failure');
  expect((await db.query<any>('select message_alert_claim() result')).rows[0].result).toEqual([]);
  const item=first[0];
  for(const subject of ['original','changed'])await db.query('select message_alert_prepare($1,$2,$3)',[item.id,item.claim_id,JSON.stringify({subject})]);
  expect((await db.query<any>('select email_payload from message_alert_outbox where id=$1',[item.id])).rows[0].email_payload.subject).toBe('original');
  await db.query('select message_alert_complete($1,$2,$3)',[item.id,item.claim_id,'provider-id']);
  expect((await db.query<any>('select message_alert_claim() result')).rows[0].result[0].kind).toBe('recovery');
});
it('retries failures with bounded attempts and rejects stale completion claims',async()=>{
  await enableAlerts();await alertReport([{category:'coordinate',failed:true}]);
  for(let i=0;i<5;i++){
    const item=(await db.query<any>('select message_alert_claim() result')).rows[0].result[0];expect(item.attempts).toBe(i+1);
    await db.query('select message_alert_complete($1,$2,null,$3)',[item.id,'90000000-0000-4000-8000-000000000001','provider_unreachable']);
    expect((await db.query<any>('select status from message_alert_outbox')).rows[0].status).toBe('sending');
    await db.query('select message_alert_complete($1,$2,null,$3)',[item.id,item.claim_id,'provider_unreachable']);
    await db.exec("update message_alert_outbox set next_attempt_at=now()-interval '1 second'");
  }
  expect((await db.query<any>('select status from message_alert_outbox')).rows[0].status).toBe('failed');
  expect((await db.query<any>('select message_alert_claim() result')).rows[0].result).toEqual([]);
});
it('only marks the current recipient tested after provider acceptance',async()=>{
  await db.query("select message_alert_admin($1,'save',$2)",[org,JSON.stringify({recipient:'admin@example.com'})]);
  await db.query("select message_alert_admin($1,'test')",[org]);
  const item=(await db.query<any>('select message_alert_claim() result')).rows[0].result[0];
  await db.query('select message_alert_complete($1,$2,$3)',[item.id,item.claim_id,'test-provider-id']);
  await db.query("select message_alert_admin($1,'enable','{\"enabled\":true}')",[org]);
  expect((await db.query<any>('select enabled from message_alert_settings')).rows[0].enabled).toBe(true);
});
it('restricts alert data and reporting to authorized administrators and the service',async()=>{
  await enableAlerts();await db.exec('set local role authenticated');
  await rejectAlertSql(()=>db.query('select * from message_alert_settings'),'permission denied');
  await rejectAlertSql(()=>db.query('select message_alert_report($1,$2,\'[]\')',[worker,token]),'permission denied');
  await rejectAlertSql(()=>db.query("select message_alert_admin($1,'status')",[other]),'Organization administrator required');
  await db.exec('reset role');await db.exec('set local role service_role');
  expect((await db.query<any>('select message_alert_report($1,$2,\'[]\') result',[worker,token])).rows[0].result.organization_id).toBe(org);
});
