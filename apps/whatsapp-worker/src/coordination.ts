import { occurrences, renderMessage, type Schedule } from '../../../packages/communications/src/index.js';
import type { Attempt } from './dispatch.js';
export const SYNC_INTERVAL_MS = 30000;
export const GROUP_INTERVAL_MS = 15 * 60000;
export type WorkerSchedule = Schedule & { updated_at: string };
export interface CoordinationPacket {
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

/** One independently scheduled coordination request, including during browser maintenance. */
export function startCoordination(run:()=>Promise<void>,onError:(error:unknown)=>void) {
  let busy=false,stopped=false;
  const tick=async()=>{if(busy||stopped)return;busy=true;try{await run();}catch(error){onError(error);}finally{busy=false;}};
  const timer=setInterval(()=>void tick(),SYNC_INTERVAL_MS);
  return {run:tick,stop:()=>{stopped=true;clearInterval(timer);}};
}
