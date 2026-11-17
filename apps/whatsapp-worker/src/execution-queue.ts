import { scheduleDeadline } from './timing.js';
import { dispatch, type Attempt, type DispatchDependencies } from './dispatch.js';
interface Entry { execution:Attempt; cancel:()=>void; inFlight:boolean }
export class LocalExecutionQueue {
  readonly inFlight=new Set<string>();
  private entries=new Map<string,Entry>();
  constructor(private deps:DispatchDependencies & { prepare(id:string):Promise<unknown>; onError(error:unknown):void }) {}
  update(executions:Attempt[],automaticEnabled:boolean) {
    const eligible=executions.filter(e=>e.is_test||automaticEnabled);
    const ids=new Set(eligible.map(e=>e.id));
    for(const [id,entry] of this.entries)if(!ids.has(id)&&!entry.inFlight){entry.cancel();this.entries.delete(id);}
    for(const e of eligible){
      const prior=this.entries.get(e.id);
      if(prior?.inFlight)continue;
      if(prior&&executionKey(prior.execution)===executionKey(e))continue;
      prior?.cancel();
      const entry:Entry={execution:e,cancel:()=>{},inFlight:false};this.entries.set(e.id,entry);
      entry.cancel=scheduleDeadline(new Date(Math.max(Date.now(),Date.parse(e.scheduled_at)-60000)).toISOString(),()=>void this.prepare(entry));
    }
  }
  private async prepare(entry:Entry):Promise<void> {
    if(this.entries.get(entry.execution.id)!==entry)return;
    const e=entry.execution,deadline=e.is_test?Date.parse(e.expires_at!):Date.parse(e.scheduled_at)+5000;
    if(Date.now()>deadline){this.entries.delete(e.id);return;}
    try{
      if(!await this.deps.ready()||!await this.deps.prepare(e.id)){this.retry(entry);return;}
      if(this.entries.get(e.id)!==entry)return;
      entry.cancel=scheduleDeadline(e.scheduled_at,()=>{
        entry.inFlight=true;this.inFlight.add(e.id);
        void dispatch(e,this.deps).catch(this.deps.onError).finally(()=>{this.inFlight.delete(e.id);if(this.entries.get(e.id)===entry)this.entries.delete(e.id);});
      });
    }catch(error){this.deps.onError(error);this.retry(entry);}
  }
  private retry(entry:Entry) {
    if(this.entries.get(entry.execution.id)!==entry)return;
    const timer=setTimeout(()=>void this.prepare(entry),Date.now()<Date.parse(entry.execution.scheduled_at)?5000:1000);
    entry.cancel=()=>clearTimeout(timer);
  }
  invalidateSchedules(schedules:Array<{id:string;revision:number}>) {
    const revisions=new Map(schedules.map(s=>[s.id,s.revision]));
    for(const [id,entry] of this.entries){
      const e=entry.execution;
      if(!entry.inFlight&&!e.is_test&&e.schedule_id&&revisions.get(e.schedule_id)!==e.schedule_revision){entry.cancel();this.entries.delete(id);}
    }
  }
  stop(){for(const entry of this.entries.values())entry.cancel();this.entries.clear();}
}

function executionKey(e:Attempt){return JSON.stringify([e.id,e.body,e.group_id,e.scheduled_at,e.expires_at,e.schedule_revision]);}
