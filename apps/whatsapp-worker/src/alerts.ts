export const alertCategories=['connection','compatibility','coordinate','commands','group_sync','dispatch','journal_recovery','browser_suspend','startup','pairing_port'] as const;
export type AlertCategory=typeof alertCategories[number];
export interface AlertState {category:AlertCategory;failed:boolean;dirty:boolean}
/** Durable desired state, rather than an append-only stream of repeated retry failures. */
export class WorkerAlerts {
  private states=new Map<AlertCategory,AlertState>();
  private revision:string|null|undefined;
  synchronize(revision:string|null|undefined){
    if(revision!==this.revision){this.revision=revision;for(const state of this.states.values())state.dirty=true;this.persist();}
    return this.flush();
  }
  private pending:Promise<void>|null=null;
  private forceQueued=false;
  constructor(private io:{save(states:AlertState[]):void;send(events:Array<{category:AlertCategory;failed:boolean}>):Promise<{enabled:boolean}>},saved:AlertState[]=[]){
    for(const state of saved)if(alertCategories.includes(state.category))this.states.set(state.category,{...state,dirty:true});
  }
  update(category:AlertCategory,failed:boolean){
    const prior=this.states.get(category);if(prior?.failed===failed||(!prior&&!failed))return;
    this.states.set(category,{category,failed,dirty:true});this.persist();void this.flush();
  }
  private persist(){this.io.save([...this.states.values()]);}
  flush(force=false):Promise<void>{
    if(this.pending){if(force)this.forceQueued=true;return this.pending;}
    const batch=[...this.states.values()].filter(s=>s.dirty).map(s=>({...s}));
    if(!batch.length&&!force)return Promise.resolve();
    this.pending=Promise.resolve().then(()=>this.io.send(batch.map(({category,failed})=>({category,failed})))).then(result=>{
      for(const sent of batch){const current=this.states.get(sent.category);if(!current||current.failed!==sent.failed)continue;
        if(!current.failed)this.states.delete(sent.category);else if(result.enabled)current.dirty=false;
      }
      this.persist();
    }).catch(()=>{/* Retain state for the next normal coordination; never recursively alert on alert failures. */}).finally(()=>{this.pending=null;
      const forceAgain=this.forceQueued;this.forceQueued=false;
      if(forceAgain||[...this.states.values()].some(current=>current.dirty&&!batch.some(sent=>sent.category===current.category&&sent.failed===current.failed)))return this.flush(forceAgain);
    });
    return this.pending;
  }
}
