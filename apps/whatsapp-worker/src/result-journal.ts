import type { Result } from './dispatch.js';
export interface JournalEntry { result:Result; reported?:string; failures:number; nextReportAt:number; nextReconcileAt:number }
export class ResultJournal {
  private entries=new Map<string,JournalEntry>();
  private reporting=new Set<string>();
  private reconciling=new Set<string>();
  constructor(private io:{save(id:string,entry:JournalEntry):void;remove(id:string):void;report(result:Result):Promise<void>;acknowledgement(id:string):Promise<number|null>;now():number},initial:Array<JournalEntry|Result>=[]) {
    for(const saved of initial){const entry='result' in saved?saved:{result:saved,failures:0,nextReportAt:0,nextReconcileAt:0};this.entries.set(entry.result.id,entry);}
  }
  record(result:Result) {
    const prior=this.entries.get(result.id);
    const entry:JournalEntry={result:{...result},reported:prior?.reported,failures:prior?.failures??0,nextReportAt:prior?.nextReportAt??0,nextReconcileAt:prior?.nextReconcileAt??0};
    if(JSON.stringify(prior?.result)!==JSON.stringify(result)){entry.failures=0;entry.nextReportAt=0;}
    this.entries.set(result.id,entry);this.io.save(result.id,entry);
  }
  async report(result:Result){if(!this.entries.has(result.id))this.record(result);await this.flush(result.id);}
  private async flush(id:string) {
    const entry=this.entries.get(id);if(!entry||this.reporting.has(id)||entry.nextReportAt>this.io.now())return;
    const fingerprint=JSON.stringify(entry.result);if(entry.reported===fingerprint)return;
    this.reporting.add(id);
    try{
      await this.io.report(entry.result);
      entry.reported=fingerprint;entry.failures=0;entry.nextReportAt=0;
      if(this.entries.get(id)!==entry)return;
      if(entry.result.status!=='unknown'){this.entries.delete(id);this.io.remove(id);}else this.io.save(id,entry);
    }catch(error){entry.failures++;entry.nextReportAt=this.io.now()+Math.min(300000,[5000,15000,30000,60000,120000][entry.failures-1]??300000);this.io.save(id,entry);throw error;}
    finally{this.reporting.delete(id);}
  }
  acknowledge(messageId:string,at:number){for(const entry of this.entries.values())if(entry.result.provider_message_id===messageId&&entry.result.status==='unknown'){
    this.record({...entry.result,status:'sent',acknowledgement_at:new Date(at).toISOString(),error:undefined});
  }}
  async tick(inFlight:Set<string>,ready:boolean,onError:(error:unknown)=>void) {
    for(const [id,entry] of this.entries){
      if(inFlight.has(id))continue;
      if(ready&&entry.result.status==='unknown'&&entry.result.provider_message_id&&entry.nextReconcileAt<=this.io.now()&&!this.reconciling.has(id)){
        entry.nextReconcileAt=this.io.now()+300000;this.reconciling.add(id);
        void this.io.acknowledgement(entry.result.provider_message_id).then(ack=>{if(ack!==null&&ack>=1)this.acknowledge(entry.result.provider_message_id!,this.io.now());}).catch(onError).finally(()=>this.reconciling.delete(id));
      }
      await this.flush(id).catch(onError);
    }
  }
}
