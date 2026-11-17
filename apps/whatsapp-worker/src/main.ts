import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, unlinkSync, rmdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';
import { occurrences, renderMessage, type Schedule } from '../../../packages/communications/src/index.js';
import { readConfig, root, persist, log } from './config.js';
import { WhatsAppProvider, browserDoctor } from './provider.js';
import { dispatch, type Attempt, type Result } from './dispatch.js';
import { scheduleDeadline } from './timing.js';
import { BackgroundWorkerStep, WorkerOperationError, processingError, runWorkerSteps, type WorkerStep } from './operations.js';

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
const journalRoot = join(root,'journal'); mkdirSync(journalRoot,{recursive:true,mode:0o700});
const db = createClient(config.supabase_url, config.publishable_key, { auth: { persistSession: false, autoRefreshToken: false } });
async function rpc<T = any>(operation: string, data: unknown = {}): Promise<T> {
  const {data: result, error} = await db.rpc('message_worker',{p_worker_id:config.worker_id,p_token:config.token,p_instance_id:instance,p_operation:operation,p_data:data}).abortSignal(AbortSignal.timeout(4000));
  if(error) throw new WorkerOperationError(operation, /^[A-Z0-9_]{1,30}$/.test(error.code ?? '') ? error.code : 'rpc_failed');
  return result as T;
}
const provider = new WhatsAppProvider(config);
provider.onDiagnostic = (event, fields) => log(event, fields);
let compatible=false, stopping=false, nextSync=0, nextScan=0, nextReconnect=0, reconnectDelay=1000, nextDue=0, nextCommand=0;
const timers=new Map<string, () => void>();
const inflight = new Set<string>(), prepared = new Map<string, Attempt>(), acknowledgements = new Map<string, number>();
function journal(result: Result) {
  persist(join(journalRoot,result.id+'.json'),result);
  log('execution_recorded',{execution_id:result.id,status:result.status,dispatch_at:result.dispatch_at,acknowledgement_at:result.acknowledgement_at});
}
async function report(result: Result) { await rpc('result',result); }
provider.onAck = (id,ack) => { if (ack >= 1) acknowledgements.set(id,Date.now()); };

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

let replaying=false,nextReplay=0;
async function recoverJournal() {
  for(const [id,at] of acknowledgements)if(Date.now()-at>3600000)acknowledgements.delete(id);
  for(const file of readdirSync(journalRoot).filter(f=>/^[0-9a-f-]{36}\.json$/.test(f))){
    const path=join(journalRoot,file), result:Result=JSON.parse(readFileSync(path,'utf8'));
    if(inflight.has(result.id))continue;
    if(result.provider_message_id&&result.status==='unknown'&&provider.state==='ready'&&!acknowledgements.has(result.provider_message_id)){
      const ack=await provider.acknowledgement(result.provider_message_id).catch(()=>null);
      if(ack!==null&&ack>=1)acknowledgements.set(result.provider_message_id,Date.now());
    }
    if(result.provider_message_id&&acknowledgements.has(result.provider_message_id)){
      result.status='sent'; result.acknowledgement_at=new Date(acknowledgements.get(result.provider_message_id)!).toISOString(); delete result.error; journal(result);
    }
    await report(result);
    if(result.status==='sent'||result.status==='failed'||result.status==='missed'){unlinkSync(path);if(result.provider_message_id)acknowledgements.delete(result.provider_message_id);}
    // Unknown records remain for reconciliation; they are never sent again.
  }
}
async function scan() {
  const at=new Date().toISOString(), data=await rpc('scan');
  for(const s of data.schedules as Schedule[]){
    const from=new Date(Math.max(Date.parse(data.last_scan_at)-60000,Date.parse((s as Schedule & {updated_at:string}).updated_at))).toISOString();
    const until=new Date(Date.now()+86400000).toISOString();
    for(const scheduled_at of occurrences(s,from,until)){
      let body='',error:string|undefined;
      try{body=renderMessage(s.body,scheduled_at,s.timezone,s);}catch{error='Template variables are invalid or missing';}
      await rpc('materialize',{schedule_id:s.id,revision:s.revision,scheduled_at,body,error});
    }
  }
  await rpc('scanned',{at});
}
function arm(e:Attempt) {
  if(timers.has(e.id)||inflight.has(e.id))return;
  timers.set(e.id,scheduleDeadline(e.scheduled_at,()=>{
    timers.delete(e.id);
    if(!prepared.has(e.id)||stopping)return;
    inflight.add(e.id);prepared.delete(e.id);
    void dispatch(e,{now:Date.now,ready:()=>provider.ready(),authorize:id=>rpc('authorize',{id}),journal,send:(group,body)=>provider.send(group,body),report})
      .catch(()=>log('dispatch_error',{execution_id:e.id})).finally(()=>inflight.delete(e.id));
  }));
}
const groupSync = new BackgroundWorkerStep();
const processingFailures = new Map<string, number>();
function processingFailed(step: string, error: unknown) {
  const fields = processingError(error), key = `${step}:${fields.operation ?? ''}:${fields.code}`;
  if(Date.now()-(processingFailures.get(key) ?? 0)<10000)return;
  processingFailures.set(key,Date.now());
  log('worker_processing_failed',{step,...fields});
}
let heartbeatBusy=false;
async function heartbeat(){
  if(heartbeatBusy||stopping)return;
  heartbeatBusy=true;
  try{await rpc('heartbeat',{state:provider.state,compatible});}catch{log('heartbeat_failed');}finally{heartbeatBusy=false;}
}
async function tick() {
  const now=Date.now();
  if(!replaying&&now>=nextReplay){nextReplay=now+10000;replaying=true;void recoverJournal().catch(error=>log('journal_recovery_failed',processingError(error))).finally(()=>{replaying=false;});}
  const steps: WorkerStep[]=[];
  if(now>=nextCommand){nextCommand=now+10000;steps.push({name:'commands',run:async()=>{
    for(const command of await rpc('commands')){
      if(command.command==='disconnect'){await provider.disconnect();prepared.clear();}
      if(command.command==='reconnect'){void provider.reconnect();}
      await rpc('command_complete',{id:command.id});
    }
  }});}
  if(provider.state==='disconnected'&&now>=nextReconnect){nextReconnect=now+reconnectDelay;reconnectDelay=Math.min(reconnectDelay*2,60000);void provider.reconnect();}
  if(provider.state==='ready')reconnectDelay=1000;
  if(provider.state==='ready'&&now>=nextSync){nextSync=now+60000;groupSync.start({name:'group_sync',run:async()=>{await rpc('sync',{groups:await provider.groups()});}},processingFailed);}
  if(now>=nextScan){nextScan=now+15000;steps.push({name:'schedule_scan',run:scan});}
  if(now>=nextDue){nextDue=now+1000;steps.push({name:'due_executions',run:async()=>{
    const due:Attempt[]=await rpc('due');
    const ids=new Set(due.map(e=>e.id));
    for(const id of prepared.keys())if(!ids.has(id)){prepared.delete(id);timers.get(id)?.();timers.delete(id);}
    for(const e of due){
      if(inflight.has(e.id))continue;
      if(!prepared.has(e.id)&&provider.state==='ready'&&await provider.ready()){
        const p=await rpc<Attempt|null>('prepare',{id:e.id});if(p){prepared.set(e.id,e);arm(e);}
      }
    }
  }});}
  await runWorkerSteps(steps,processingFailed);
}
async function shutdown(){if(stopping)return;stopping=true;for(const cancel of timers.values())cancel();server.close();await provider.client.destroy().catch(()=>{});unlinkSync(join(lock,'owner.json'));rmdirSync(lock);process.exit(0);}
process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
async function main(){
  try{const result=await browserDoctor(config);compatible=true;log('compatibility_passed',result);}catch{log('compatibility_failed');await rpc('heartbeat',{state:'incompatible',compatible:false}).catch(()=>{});await shutdown();return;}
  await rpc('heartbeat',{state:provider.state,compatible});
  setInterval(()=>void heartbeat(),10000).unref();
  void provider.connect();
  let lastErrorLog=0;
  while(!stopping){const start=performance.now();try{await tick();}catch{if(Date.now()-lastErrorLog>10000){log('worker_offline_or_operation_failed');lastErrorLog=Date.now();}}
    const nearest=Math.min(...[...prepared.values()].map(e=>Date.parse(e.scheduled_at)-Date.now()),250);
    await new Promise(resolve=>setTimeout(resolve,Math.max(5,Math.min(250,nearest)-Math.min(performance.now()-start,200))));
  }
}
main().catch(()=>{log('worker_start_failed');void shutdown();});
