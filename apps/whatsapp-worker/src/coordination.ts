import { occurrences, renderMessage, type Schedule } from '../../../packages/communications/src/index.js';
import type { Attempt } from './dispatch.js';
export const SYNC_INTERVAL_MS = 30000;
export const IDLE_INTERVAL_MS = 60 * 60000;
export const ACTIVE_WINDOW_MS = 30 * 60000;
export const COOLDOWN_MS = 5 * 60000;
export const GROUP_INTERVAL_MS = 15 * 60000;
export type WorkerSchedule = Schedule & { updated_at: string };
export interface CoordinationPacket {
  adaptive_coordination?: boolean;
  alert_revision?: string | null;
  alert_pending?: boolean;
  configuration_revision: string; work_revision: string; automatic_enabled: boolean;
  last_scan_at: string; commands: Array<{id:string;command:string}>;
  configuration: { schedules: WorkerSchedule[]; destinations: Array<{id:string;group_id:string}> } | null;
  executions: Attempt[] | null;
}
export interface Materialization { schedule_id:string; revision:number; scheduled_at:string; body:string; error?:string }

/** A 24-hour horizon advances locally; already planned occurrences are not written again. */
export class ExecutionPlanner {
  private known = new Set<string>();
  private revision: string | undefined;
  private started = false;
  schedules: WorkerSchedule[] = [];
  cursor = '';
  update(packet:CoordinationPacket) {
    if(packet.configuration){
      this.schedules=packet.configuration.schedules;
      if(this.revision!==packet.configuration_revision){this.known.clear();this.started=false;}
      this.revision=packet.configuration_revision;
    }
    if(!this.cursor)this.cursor=packet.last_scan_at;
  }
  plan(now:number):{items:Materialization[];scanned_at:string}|null {
    const at=new Date(now).toISOString(), until=new Date(now+86400000).toISOString();
    const items:Materialization[]=[];
    for(const s of this.schedules){
      const from=new Date(Math.max(Date.parse(this.cursor)-60000,Date.parse(s.updated_at))).toISOString();
      for(const scheduled_at of occurrences(s,from,until)){
        const key=`${s.id}:${s.revision}:${scheduled_at}`;
        if(this.known.has(key))continue;
        let body='',error:string|undefined;
        try{body=renderMessage(s.body,scheduled_at,s.timezone,s);}catch{error='Template variables are invalid or missing';}
        items.push({schedule_id:s.id,revision:s.revision,scheduled_at,body,error});
      }
    }
    return items.length||!this.started?{items,scanned_at:at}:null;
  }
  committed(batch:{items:Materialization[];scanned_at:string}) {
    for(const e of batch.items)this.known.add(`${e.schedule_id}:${e.revision}:${e.scheduled_at}`);
    this.cursor=batch.scanned_at;this.started=true;
  }
}

export type WorkerMode = 'active' | 'idle';
/** Local schedule calculations never query Supabase. Includes the post-send cooldown. */
export class WorkerActivity {
  private maintenanceUntil: number;
  constructor(startedAt: number) { this.maintenanceUntil = startedAt + ACTIVE_WINDOW_MS; }
  maintain(now: number) { this.maintenanceUntil = Math.max(this.maintenanceUntil, now + ACTIVE_WINDOW_MS); }
  snapshot(now: number, schedules: WorkerSchedule[], automaticEnabled: boolean, inFlight = false) {
    let active = now < this.maintenanceUntil || inFlight;
    let nextWakeAt = now + IDLE_INTERVAL_MS;
    if (automaticEnabled) for (const schedule of schedules) {
      if (!schedule.enabled) continue;
      const dates = occurrences(schedule, new Date(now - COOLDOWN_MS + 1).toISOString(), new Date(now + IDLE_INTERVAL_MS + ACTIVE_WINDOW_MS + 1).toISOString());
      for (const date of dates) {
        const at = Date.parse(date);
        if (at - ACTIVE_WINDOW_MS <= now) active = true;
        else nextWakeAt = Math.min(nextWakeAt, at - ACTIVE_WINDOW_MS);
      }
    }
    return { mode: active ? 'active' as const : 'idle' as const, nextWakeAt: active ? now + SYNC_INTERVAL_MS : nextWakeAt };
  }
}

/** Browser work stays independent; explicit runs also reset the next coordination deadline. */
export function startCoordination(run:()=>Promise<void>,onError:(error:unknown)=>void,nextAt:()=>number=()=>Date.now()+SYNC_INTERVAL_MS) {
  let stopped=false,due=Date.now()+SYNC_INTERVAL_MS,pending:Promise<void>|null=null;
  const tick=():Promise<void>=>{
    if(stopped)return Promise.resolve();
    if(pending)return pending;
    pending=Promise.resolve().then(run).catch(onError).finally(()=>{pending=null;due=nextAt();});
    return pending;
  };
  // A local clock check also handles wake from Mac sleep without hourly timer drift.
  const timer=setInterval(()=>{if(Date.now()>=due)void tick();},1000);
  return {run:tick,stop:async()=>{stopped=true;clearInterval(timer);await pending;}};
}
