import { describe, expect, it, vi } from 'vitest';
import { occurrences, renderMessage, oneTimeInstant, scheduleSchema, dispatchDecision, type ScheduleInput } from '../../packages/communications/src/index';
import { dispatch, type Attempt, type Result } from '../../apps/whatsapp-worker/src/dispatch';
const base: ScheduleInput = { name:'Weekly',body:'Date {{next_sunday_date}} at {{venue}} {{match_time}}',destination_id:null,frequency:'weekly',timezone:'America/Toronto',local_time:'21:00:00',local_date:null,weekdays:[1],venue:'Bell Sensplex',match_time:'7–9 AM',enabled:false };
import { scheduleDeadline } from '../../apps/whatsapp-worker/src/timing';

describe('communications recurrence and templates',()=>{
  it('keeps Monday at 9 PM across Toronto DST',()=>{
    expect(occurrences(base,'2026-03-01T00:00:00Z','2026-03-17T00:00:00Z')).toEqual(['2026-03-03T02:00:00Z','2026-03-10T01:00:00Z']);
    expect(occurrences(base,'2026-10-25T00:00:00Z','2026-11-10T00:00:00Z')).toEqual(['2026-10-27T01:00:00Z','2026-11-03T02:00:00Z']);
  });
  it('skips spring-forward gaps and chooses the earlier fall-back occurrence',()=>{
    const s={...base,frequency:'daily' as const,local_time:'02:30:00'};
    expect(occurrences(s,'2026-03-08T00:00:00Z','2026-03-10T00:00:00Z')).toEqual(['2026-03-09T06:30:00Z']);
    expect(occurrences({...s,local_time:'01:30:00'},'2026-11-01T00:00:00Z','2026-11-02T00:00:00Z')).toEqual(['2026-11-01T05:30:00Z']);
  });
  it('rejects nonexistent one-time dates and resolves ambiguous dates explicitly',()=>{
    expect(()=>oneTimeInstant({...base,local_date:'2026-03-08',local_time:'02:30:00'})).toThrow();
    expect(oneTimeInstant({...base,local_date:'2026-11-01',local_time:'01:30:00'})).toBe('2026-11-01T05:30:00Z');
  });
  it('uses the scheduled local date, including strictly-next Sunday',()=>{
    expect(renderMessage(base.body,'2026-11-17T02:00:00Z',base.timezone,base)).toContain('Sunday, November 22, 2026');
    expect(renderMessage('{{next_sunday_date}}','2026-11-23T02:00:00Z',base.timezone,base)).toBe('Sunday, November 29, 2026');
    expect(()=>renderMessage('{{missing}}','2026-11-17T02:00:00Z',base.timezone,base)).toThrow('unknown variable');
    expect(()=>renderMessage('{{venue}}','2026-11-17T02:00:00Z',base.timezone,{...base,venue:''})).toThrow();
  });
  it('validates timezone, weekday selection, and destinations before enabling',()=>{
    expect(scheduleSchema.safeParse({...base,enabled:true}).success).toBe(false);
    expect(scheduleSchema.safeParse({...base,timezone:'Unknown'}).success).toBe(false);
    expect(scheduleSchema.safeParse({...base,weekdays:[]}).success).toBe(false);
  });
  it('does not send early or more than five seconds late',()=>{
    const at='2026-11-17T02:00:00Z', n=Date.parse(at);
    expect(dispatchDecision(at,n-1)).toBe('wait');expect(dispatchDecision(at,n)).toBe('send');
    expect(dispatchDecision(at,n+5000)).toBe('send');expect(dispatchDecision(at,n+5001)).toBe('missed');
  });
});
describe('dispatch safety using a mock provider',()=>{
  const at=Date.parse('2026-11-17T02:00:00Z');
  const attempt:Attempt={id:'execution',attempt_id:'attempt',scheduled_at:new Date(at).toISOString(),group_id:'group@g.us',body:'Hello'};
  function mocks(){const records:Result[]=[];return {records,now:()=>at,ready:vi.fn(async()=>true),authorize:vi.fn(async()=>attempt),journal:(r:Result)=>records.push({...r}),send:vi.fn(async()=>({id:'message',ack:1})),report:vi.fn(async()=>{})};}
  it('journals before sending and records invocation/ack times',async()=>{
    const deps=mocks();deps.send.mockImplementation(async()=>{expect(deps.records.at(-1)?.status).toBe('unknown');expect(deps.records.at(-1)?.dispatch_at).toBeNull();return{id:'message',ack:1};});
    await dispatch(attempt,deps);expect(deps.send).toHaveBeenCalledTimes(1);expect(deps.records.at(-1)?.status).toBe('sent');expect(deps.records.at(-1)?.acknowledgement_at).toBe(new Date(at).toISOString());
  });
  it('fails closed when offline, revoked, early, or missed',async()=>{
    const offline=mocks();offline.ready.mockResolvedValue(false);await dispatch(attempt,offline);expect(offline.send).not.toHaveBeenCalled();
    const revoked=mocks();revoked.authorize=vi.fn(async()=>null) as any;await dispatch(attempt,revoked);expect(revoked.send).not.toHaveBeenCalled();
    for(const now of [at-1,at+5001]){const deps={...mocks(),now:()=>now};await dispatch(attempt,deps);expect(deps.send).not.toHaveBeenCalled();}
  });
  it('marks ambiguous errors unknown without retrying',async()=>{
    const deps=mocks();deps.send.mockRejectedValue(new Error('connection lost'));await dispatch(attempt,deps);expect(deps.send).toHaveBeenCalledTimes(1);expect(deps.records.at(-1)?.status).toBe('unknown');
  });
  it('never calls the provider when durable intent cannot be recorded',async()=>{
    const deps={...mocks(),journal:()=>{throw new Error('disk full');}};await expect(dispatch(attempt,deps)).rejects.toThrow();expect(deps.send).not.toHaveBeenCalled();
  });
  it('rechecks the deadline after database authorization',async()=>{
    let now=at;const deps={...mocks(),now:()=>now};deps.authorize.mockImplementation(async()=>{now=at+5001;return attempt;});await dispatch(attempt,deps);expect(deps.send).not.toHaveBeenCalled();
  });
});

describe('local deadline timer',()=>{
  it('fires at the target independently of polling',()=>{
    vi.useFakeTimers();try{vi.setSystemTime(new Date('2026-11-17T01:59:59Z'));const fire=vi.fn();scheduleDeadline('2026-11-17T02:00:00Z',fire);vi.advanceTimersByTime(999);expect(fire).not.toHaveBeenCalled();vi.advanceTimersByTime(1);expect(fire).toHaveBeenCalledOnce();}finally{vi.useRealTimers();}
  });
  it('rechecks backward clock corrections and permits cancellation',()=>{
    vi.useFakeTimers();try{vi.setSystemTime(new Date('2026-11-17T01:59:59Z'));const fire=vi.fn();const cancel=scheduleDeadline('2026-11-17T02:00:00Z',fire);vi.advanceTimersByTime(500);vi.setSystemTime(new Date('2026-11-17T01:59:58Z'));vi.advanceTimersByTime(1500);expect(fire).not.toHaveBeenCalled();cancel();vi.advanceTimersByTime(10000);expect(fire).not.toHaveBeenCalled();}finally{vi.useRealTimers();}
  });
  it('detects an expired dispatch window after sleep',()=>{
    vi.useFakeTimers();try{vi.setSystemTime(new Date('2026-11-17T01:59:59Z'));const decision=vi.fn();scheduleDeadline('2026-11-17T02:00:00Z',()=>decision(dispatchDecision('2026-11-17T02:00:00Z',Date.now())));vi.setSystemTime(new Date('2026-11-17T02:00:10Z'));vi.advanceTimersByTime(250);expect(decision).toHaveBeenCalledWith('missed');}finally{vi.useRealTimers();}
  });
});
