import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, unlinkSync, rmdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';
import { readConfig, root, persist, log } from './config.js';
import { WhatsAppProvider, browserDoctor } from './provider.js';
import type { Attempt, Result } from './dispatch.js';
import { BackgroundWorkerStep, WorkerOperationError, processingError } from './operations.js';
import { ExecutionPlanner, startCoordination, GROUP_INTERVAL_MS, type CoordinationPacket } from './coordination.js';
import { LocalExecutionQueue } from './execution-queue.js';
import { ResultJournal, type JournalEntry } from './result-journal.js';
import { RpcMetrics } from './metrics.js';

const config = readConfig(), instance = randomUUID(), lock = join(root, 'worker.lock');
try { mkdirSync(lock, { mode: 0o700 }); }
catch {
  if(!existsSync(join(lock,'owner.json')) && Date.now()-statSync(lock).mtimeMs>30000){
    rmdirSync(lock);mkdirSync(lock,{mode:0o700});
  } else {
  const owner = JSON.parse(readFileSync(join(lock,'owner.json'),'utf8'));
  let alive = true;
  try { process.kill(owner.pid, 0); } catch (error) { alive = (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
  if (alive) throw new Error('Worker already running');
  unlinkSync(join(lock,'owner.json')); rmdirSync(lock); mkdirSync(lock,{mode:0o700});
  }
}
persist(join(lock,'owner.json'), {pid:process.pid});
const journalRoot=join(root,'journal');mkdirSync(journalRoot,{recursive:true,mode:0o700});
const db=createClient(config.supabase_url,config.publishable_key,{auth:{persistSession:false,autoRefreshToken:false}});
const metrics=new RpcMetrics();
async function request<T=any>(procedure:string,operation:string,data:unknown):Promise<T>{
  const args={p_worker_id:config.worker_id,p_token:config.token,p_instance_id:instance,...(procedure==='message_worker'?{p_operation:operation}:{}),p_data:data};
  let response:unknown=null,failed=true;
  try{
    const {data:result,error}=await db.rpc(procedure,args).abortSignal(AbortSignal.timeout(4000));response=result;
    if(error)throw new WorkerOperationError(operation,/^[A-Z0-9_]{1,30}$/.test(error.code??'')?error.code:'rpc_failed');
    failed=false;return result as T;
  }finally{metrics.record(operation,args,response,failed);}
}
const rpc=<T=any>(operation:string,data:unknown={})=>request<T>('message_worker',operation,data);
const provider=new WhatsAppProvider(config);provider.onDiagnostic=(event,fields)=>log(event,fields);
let compatible=false,stopping=false,ownsLease=false,nextGroups=0,nextReconnect=0,reconnectDelay=1000,groupHash='';
let configRevision:string|undefined,workRevision:string|undefined,executions:Attempt[]=[],automaticEnabled=false;
const failures=new Map<string,number>();
function processingFailed(step:string,error:unknown){
  const details=processingError(error),key=step+':'+details.code;
  if(Date.now()-(failures.get(key)??0)<10000)return;failures.set(key,Date.now());log('worker_processing_failed',{step,...details});
}
const saved=readdirSync(journalRoot).filter(f=>/^[0-9a-f-]{36}\.json$/.test(f)).map(f=>JSON.parse(readFileSync(join(journalRoot,f),'utf8')) as JournalEntry|Result);
const journal=new ResultJournal({
  save:(id,entry)=>persist(join(journalRoot,id+'.json'),entry),remove:id=>unlinkSync(join(journalRoot,id+'.json')),
  report:result=>rpc('result',result),acknowledgement:id=>provider.acknowledgement(id),now:Date.now
},saved);
const earlyAcks=new Map<string,number>();
provider.onAck=(id,ack)=>{if(ack>=1){earlyAcks.set(id,Date.now());journal.acknowledge(id,Date.now());}};
const queue=new LocalExecutionQueue({
  now:Date.now,ready:()=>provider.ready(),prepare:id=>rpc('prepare',{id}),authorize:id=>rpc('authorize',{id}),
  journal:result=>{journal.record(result);if(result.provider_message_id&&earlyAcks.has(result.provider_message_id))journal.acknowledge(result.provider_message_id,earlyAcks.get(result.provider_message_id)!);log('execution_recorded',{execution_id:result.id,status:result.status,dispatch_at:result.dispatch_at});},
  send:(group,body)=>provider.send(group,body),report:result=>journal.report(result),onError:error=>processingFailed('dispatch',error)
});
const planner=new ExecutionPlanner(),groupSync=new BackgroundWorkerStep(),control=new BackgroundWorkerStep();
const queuedCommands:Array<{id:string;command:string}>=[];
const coordination=startCoordination(async()=>{
  const packet=await request<CoordinationPacket>('message_worker_coordinate','coordinate',{state:provider.state,compatible,configuration_revision:configRevision,work_revision:workRevision});
  if(!ownsLease)persist(join(root,'rpc-metrics.json'),metrics.snapshot());
  ownsLease=true;
  const configurationChanged=packet.configuration!==null;
  configRevision=packet.configuration_revision;workRevision=packet.work_revision;automaticEnabled=packet.automatic_enabled;
  planner.update(packet);
  if(packet.executions!==null)executions=packet.executions;
  // Cancel changed schedules without disturbing unrelated prepared timers; final authorization remains authoritative.
  if(configurationChanged)queue.invalidateSchedules(packet.configuration!.schedules);
  if(!automaticEnabled)queue.update(executions,false);
  queuedCommands.push(...packet.commands);
  control.start({name:'commands',run:async()=>{
    while(queuedCommands.length){
      const command=queuedCommands.shift()!;
      if(command.command==='disconnect'){queue.update([],false);await provider.disconnect();}
      if(command.command==='reconnect'){nextGroups=0;void provider.reconnect();}
      if(command.command==='refresh_groups')nextGroups=0;
      await rpc('command_complete',{id:command.id});
    }
  }},processingFailed);
  const batch=planner.plan(Date.now());
  if(batch){
    for(let index=0;index<Math.max(batch.items.length,1);index+=1000){
      const last=index+1000>=batch.items.length;
      const result=await request<{executions:Attempt[];work_revision:string}>('message_worker_materialize_batch','materialize_batch',{
        configuration_revision:configRevision,items:batch.items.slice(index,index+1000),...(last?{scanned_at:batch.scanned_at}:{})
      });executions=result.executions;workRevision=result.work_revision;
    }
    planner.committed(batch);
  }
  queue.update(executions,automaticEnabled);
},error=>{configRevision=undefined;processingFailed('coordinate',error);});

const pairingToken = randomBytes(32).toString('hex'), port=config.port??43821, pairingExpires=Date.now()+10*60*1000;
persist(join(root,'pairing.json'),{url:`http://127.0.0.1:${port}/?token=${pairingToken}`,expires_at:pairingExpires});
const server=createServer(async (req,res)=>{
  res.setHeader('Cache-Control','no-store'); res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'none'; img-src data:; style-src 'unsafe-inline'");
  const url=new URL(req.url??'/',`http://127.0.0.1:${port}`), token=url.searchParams.get('token')??'';
  if(req.method!=='GET'||req.headers.host!==`127.0.0.1:${port}`||Date.now()>pairingExpires||token.length!==pairingToken.length||!timingSafeEqual(Buffer.from(token),Buffer.from(pairingToken))){res.writeHead(403);res.end('Pairing unavailable. Run pnpm whatsapp pair.');return;}
  const qr=provider.qr&&Date.now()-provider.qrAt<60000?await QRCode.toDataURL(provider.qr):null;
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(`<!doctype html><meta name="viewport" content="width=device-width"><meta http-equiv="refresh" content="5"><title>OU Soccer WhatsApp pairing</title><main style="font:18px system-ui;max-width:600px;margin:40px auto;padding:16px"><h1>WhatsApp pairing</h1><p>Status: ${provider.state}</p>${provider.lastError ? `<p role="alert">${provider.lastError}</p>` : ''}${qr?`<p>WhatsApp → Linked devices → Link a device</p><img alt="Scan with WhatsApp" width="320" src="${qr}">`:'<p>Wait for a QR code, or check connection status in Communications.</p>'}<p>This page stays on your Mac. Pairing access expires after ten minutes; restart the worker to renew it.</p></main>`);
});
server.listen(port,'127.0.0.1');
server.on('error',()=>{log('pairing_port_unavailable');void shutdown();});

async function shutdown(){
  if(stopping)return;stopping=true;coordination.stop();queue.stop();server.close();
  await provider.client.destroy().catch(()=>{});
  if(ownsLease)await request('message_worker_coordinate','release',{release:true}).catch(()=>{});
  persist(join(root,'rpc-metrics.json'),metrics.snapshot());
  unlinkSync(join(lock,'owner.json'));rmdirSync(lock);process.exit(0);
}
process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
async function main(){
  try{const result=await browserDoctor(config);compatible=true;log('compatibility_passed',result);}
  catch{log('compatibility_failed');await coordination.run();await shutdown();return;}
  await coordination.run();
  if(!ownsLease)throw new Error('Coordination failed; verify migration 111 and the worker credential');
  void provider.connect();
  let nextMetrics=Date.now()+3600000,recovering=false,wasReady=false;
  while(!stopping){
    const now=Date.now();
    if(provider.state==='disconnected'&&now>=nextReconnect){nextReconnect=now+reconnectDelay;reconnectDelay=Math.min(reconnectDelay*2,60000);void provider.reconnect();}
    const ready=provider.state==='ready';
    if(ready&&!wasReady){nextGroups=0;groupHash='';}wasReady=ready;
    if(ready)reconnectDelay=1000;
    if(ready&&now>=nextGroups){nextGroups=now+GROUP_INTERVAL_MS;groupSync.start({name:'group_sync',run:async()=>{
      const groups=(await provider.groups()).sort((a,b)=>a.id.localeCompare(b.id));
      const hash=createHash('sha256').update(JSON.stringify(groups)).digest('hex');
      if(hash!==groupHash){await rpc('sync',{groups});groupHash=hash;}
    }},processingFailed);}
    if(!recovering){recovering=true;void journal.tick(queue.inFlight,ready,error=>processingFailed('journal_recovery',error)).finally(()=>{recovering=false;});}
    for(const [id,at] of earlyAcks)if(now-at>3600000)earlyAcks.delete(id);
    if(now>=nextMetrics){persist(join(root,'rpc-metrics.json'),metrics.snapshot());nextMetrics=now+3600000;}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
}
main().catch(error=>{processingFailed('startup',error);void shutdown();});
