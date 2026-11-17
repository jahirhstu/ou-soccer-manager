import { afterEach, expect, it, vi } from 'vitest';
import { ExecutionPlanner, startCoordination, SYNC_INTERVAL_MS, type CoordinationPacket } from '../../apps/whatsapp-worker/src/coordination';
import { LocalExecutionQueue } from '../../apps/whatsapp-worker/src/execution-queue';
import { ResultJournal, type JournalEntry } from '../../apps/whatsapp-worker/src/result-journal';
import { RpcMetrics } from '../../apps/whatsapp-worker/src/metrics';
import type { Result, Attempt } from '../../apps/whatsapp-worker/src/dispatch';
afterEach(()=>vi.useRealTimers());
const at=Date.parse('2026-11-17T15:00:00Z');
const execution:Attempt={id:'execution',attempt_id:'attempt',body:'Hello',group_id:'group@g.us',scheduled_at:new Date(at).toISOString()};
function packet():CoordinationPacket{return{configuration_revision:'1',work_revision:'1',automatic_enabled:true,last_scan_at:'2026-11-17T00:00:00Z',commands:[],executions:[],configuration:{destinations:[],schedules:[{id:'schedule',organization_id:'org',created_at:'2026-11-16T00:00:00Z',updated_at:'2026-11-16T00:00:00Z',revision:1,name:'Test',body:'Sunday {{next_sunday_date}}',frequency:'daily',timezone:'America/Toronto',local_time:'10:00:00',local_date:null,weekdays:[1],venue:'Bell',match_time:'7 AM',enabled:true,destination_id:null}]}};}
it('uses approximately 2880 coordination requests per 24 idle hours without one-second polling',async()=>{
  vi.useFakeTimers();const run=vi.fn(async()=>{});const loop=startCoordination(run,vi.fn());
  await loop.run();await vi.advanceTimersByTimeAsync(86400000-SYNC_INTERVAL_MS);loop.stop();expect(run).toHaveBeenCalledTimes(2880);
});
it('does not overlap slow coordination calls',async()=>{
  vi.useFakeTimers();let resolve!:()=>void;const run=vi.fn(()=>new Promise<void>(done=>{resolve=done;}));
  const loop=startCoordination(run,vi.fn());const first=loop.run();await vi.advanceTimersByTimeAsync(90000);expect(run).toHaveBeenCalledOnce();resolve();await first;loop.stop();
});
it('batches a 24-hour horizon once and avoids repeated materialization for unchanged schedules',()=>{
  const planner=new ExecutionPlanner();planner.update(packet());const first=planner.plan(at-3600000)!;expect(first.items).toHaveLength(1);planner.committed(first);
  expect(planner.plan(at-3500000)).toBeNull();const later=planner.plan(at+1000)!;expect(later.items).toHaveLength(1);expect(later.items[0].scheduled_at).toBe('2026-11-18T15:00:00Z');
});
it('does not lose outage reconciliation when a configuration revision changes',()=>{
  const planner=new ExecutionPlanner(),p=packet();planner.update(p);const first=planner.plan(at-3600000)!;planner.committed(first);
  planner.update({...p,configuration_revision:'2',configuration:{...p.configuration!,schedules:p.configuration!.schedules.map(s=>({...s,revision:2,body:'Updated'}))}});
  expect(planner.plan(at+6000)!.items.some(e=>e.scheduled_at==='2026-11-17T15:00:00Z')).toBe(true);
});
it('prepares ahead and dispatches at the exact local timer deadline without a database due poll',async()=>{
  vi.useFakeTimers();vi.setSystemTime(at-90000);
  const prepare=vi.fn(async()=>true),send=vi.fn(async()=>({id:'message',ack:1})),authorize=vi.fn(async()=>execution);
  const queue=new LocalExecutionQueue({now:Date.now,prepare,send,authorize,ready:async()=>true,journal:()=>{},report:async()=>{},onError:vi.fn()});
  queue.update([execution],true);await vi.advanceTimersByTimeAsync(30000);expect(prepare).toHaveBeenCalledOnce();expect(send).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60000);expect(send).toHaveBeenCalledOnce();expect(authorize).toHaveBeenCalledOnce();queue.stop();
});
it('cancels cached execution timers after disable and never dispatches a stale cached message',async()=>{
  vi.useFakeTimers();vi.setSystemTime(at-10000);const send=vi.fn(async()=>({id:'m',ack:1}));
  const queue=new LocalExecutionQueue({now:Date.now,prepare:async()=>true,send,authorize:async()=>execution,ready:async()=>true,journal:()=>{},report:async()=>{},onError:vi.fn()});
  queue.update([execution],true);await vi.advanceTimersByTimeAsync(1);queue.update([],false);await vi.advanceTimersByTimeAsync(20000);expect(send).not.toHaveBeenCalled();queue.stop();
});
it('does not repeat preparation when only database phase metadata changes',async()=>{
  vi.useFakeTimers();vi.setSystemTime(at-60000);const prepare=vi.fn(async()=>true);
  const queue=new LocalExecutionQueue({now:Date.now,prepare,send:async()=>({id:'m',ack:1}),authorize:async()=>execution,ready:async()=>true,journal:()=>{},report:async()=>{},onError:vi.fn()});
  queue.update([execution],true);await vi.advanceTimersByTimeAsync(1);queue.update([{...execution,phase:'prepared'} as Attempt],true);await vi.advanceTimersByTimeAsync(1000);expect(prepare).toHaveBeenCalledOnce();queue.stop();
});
const unknown:Result={id:'e',attempt_id:'a',status:'unknown',dispatch_at:new Date(at).toISOString(),provider_message_id:'m'};
function journalMocks(){return{save:vi.fn(),remove:vi.fn(),report:vi.fn(async()=>{}),acknowledgement:vi.fn(async()=>0),now:Date.now};}
it('reports an unchanged unknown result once, rather than on every recovery tick',async()=>{
  vi.useFakeTimers();vi.setSystemTime(at);const io=journalMocks(),journal=new ResultJournal(io);journal.record(unknown);
  for(let i=0;i<100;i++){await journal.tick(new Set(),true,vi.fn());await vi.advanceTimersByTimeAsync(1000);}
  expect(io.report).toHaveBeenCalledOnce();expect(io.acknowledgement).toHaveBeenCalledOnce();
  journal.acknowledge('m',at+100000);await journal.tick(new Set(),true,vi.fn());expect(io.report).toHaveBeenCalledTimes(2);expect(io.remove).toHaveBeenCalledWith('e');
});
it('backs off failed result reports and preserves recovery evidence',async()=>{
  vi.useFakeTimers();vi.setSystemTime(at);const io=journalMocks();io.report.mockRejectedValue(new Error('offline'));const journal=new ResultJournal(io);journal.record(unknown);
  await journal.tick(new Set(),false,vi.fn());await journal.tick(new Set(),false,vi.fn());expect(io.report).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(5000);await journal.tick(new Set(),false,vi.fn());expect(io.report).toHaveBeenCalledTimes(2);expect(io.remove).not.toHaveBeenCalled();
});
it('never reports dispatch intent while its send operation is in flight',async()=>{
  const io=journalMocks(),journal=new ResultJournal(io);journal.record(unknown);await journal.tick(new Set(['e']),true,vi.fn());expect(io.report).not.toHaveBeenCalled();
});
it('restores legacy journal records and respects durable reported fingerprints',async()=>{
  const io=journalMocks();const saved:JournalEntry={result:unknown,reported:JSON.stringify(unknown),failures:0,nextReportAt:0,nextReconcileAt:Date.now()+300000};
  const journal=new ResultJournal(io,[saved]);await journal.tick(new Set(),false,vi.fn());expect(io.report).not.toHaveBeenCalled();
  const legacy=new ResultJournal(io,[unknown]);await legacy.tick(new Set(),false,vi.fn());expect(io.report).toHaveBeenCalledOnce();
});
it('counts payload sizes without retaining credential or message values',()=>{
  const metrics=new RpcMetrics();metrics.record('coordinate',{token:'PRIVATE',body:'MESSAGE'},{state:'ready'});
  const snapshot=JSON.stringify(metrics.snapshot());expect(snapshot).not.toContain('PRIVATE');expect(snapshot).not.toContain('MESSAGE');expect(metrics.snapshot().operations.coordinate.requests).toBe(1);
});

it('keeps prepared timers for unrelated configuration changes but cancels edited schedules',async()=>{
  vi.useFakeTimers();vi.setSystemTime(at-10000);const send=vi.fn(async()=>({id:'m',ack:1}));
  const e={...execution,schedule_id:'s',schedule_revision:1};
  const queue=new LocalExecutionQueue({now:Date.now,prepare:async()=>true,send,authorize:async()=>e,ready:async()=>true,journal:()=>{},report:async()=>{},onError:vi.fn()});
  queue.update([e],true);await vi.advanceTimersByTimeAsync(1);queue.invalidateSchedules([{id:'s',revision:1}]);await vi.advanceTimersByTimeAsync(9999);expect(send).toHaveBeenCalledOnce();queue.stop();
  send.mockClear();vi.setSystemTime(at-10000);queue.update([e],true);await vi.advanceTimersByTimeAsync(1);queue.invalidateSchedules([{id:'s',revision:2}]);await vi.advanceTimersByTimeAsync(10000);expect(send).not.toHaveBeenCalled();queue.stop();
});
