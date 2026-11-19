import { expect,it,vi } from 'vitest';
import { WorkerAlerts,type AlertState } from '../../apps/whatsapp-worker/src/alerts';
import {createAlertHandler,emailContent,type AlertEnvironment} from '../../supabase/functions/whatsapp-alerts/handler';
const env:AlertEnvironment={supabaseUrl:'https://project.supabase.co',serviceKey:'SERVER_SECRET',resendKey:'RESEND_SECRET',from:'alerts@example.com',monitorSecret:'MONITOR_SECRET'};
const item={id:'delivery',claim_id:'claim',recipient:'admin@example.com',kind:'failure',payload:{organization_id:'org',worker_id:'worker',category:'connection',at:'2026-11-18T16:00:00Z'}};
function fakeFetch(overrides:Record<string,unknown>={}){
  return vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(input),name=url.split('/').pop()!;
    if(name==='message_alert_report')return Response.json({organization_id:'org',enabled:true});
    if(name==='message_alert_admin'){const args=JSON.parse(String(init?.body));return Response.json(args.p_operation==='test'?{id:'new-test'}:{deliveries:overrides.deliveries??[]});}
    if(name==='message_alert_monitor')return overrides.emptyRpc?new Response(null,{status:204}):Response.json(null);
    if(name==='message_alert_claim')return Response.json(overrides.items??[item]);
    if(name==='message_alert_prepare')return Response.json(JSON.parse(String(init?.body)).p_email);
    if(name==='message_alert_complete')return overrides.emptyRpc?new Response(null,{status:204}):Response.json(null);
    if(url==='https://api.resend.com/emails'){
      if(overrides.rejectId && (init?.headers as Record<string,string>)['Idempotency-Key']===`whatsapp-alert/${overrides.rejectId}`)return Response.json({message:'Old sender rejected'},{status:403});
      if(overrides.providerError)throw new Error('PRIVATE upstream error');
      return Response.json({id:'provider-id'},{status:200});
    }
    throw new Error(`Unexpected endpoint ${name}`);
  });
}
function request(body:unknown,headers:Record<string,string>={}){return new Request('https://project.supabase.co/functions/v1/whatsapp-alerts',{method:'POST',headers,body:JSON.stringify(body)});}
it('persists and deduplicates worker failures, then reports recovery',async()=>{
  let saved:AlertState[]=[];const send=vi.fn(async()=>({enabled:true}));
  const alerts=new WorkerAlerts({save:states=>{saved=structuredClone(states);},send});
  alerts.update('connection',true);await alerts.flush();alerts.update('connection',true);await alerts.flush();expect(send).toHaveBeenCalledTimes(1);
  expect(saved[0].failed).toBe(true);
  const restored=new WorkerAlerts({save:vi.fn(),send},saved);await restored.flush();expect(send).toHaveBeenCalledTimes(2);
  restored.update('connection',false);await restored.flush();expect(send).toHaveBeenLastCalledWith([{category:'connection',failed:false}]);
});
it('retains failed reports for normal coordination without recursive alerts',async()=>{
  const send=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({enabled:true});let saved:AlertState[]=[];
  const alerts=new WorkerAlerts({save:s=>{saved=s;},send});alerts.update('coordinate',true);await alerts.flush();expect(saved[0].dirty).toBe(true);
  await alerts.flush();expect(saved[0].dirty).toBe(false);expect(send).toHaveBeenCalledTimes(2);
});
it('replays active incidents after settings change and avoids sending healthy idle updates',async()=>{
  const send=vi.fn(async()=>({enabled:true})),alerts=new WorkerAlerts({save:vi.fn(),send});
  alerts.update('connection',false);await alerts.flush();expect(send).not.toHaveBeenCalled();
  alerts.update('connection',true);await alerts.flush();await alerts.synchronize('new-settings');expect(send).toHaveBeenCalledTimes(2);
});
it('delivers a recovery that arrives while the failure report is in flight',async()=>{
  let done!:(value:{enabled:boolean})=>void;
  const send=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{done=resolve;})).mockResolvedValue({enabled:true});
  const alerts=new WorkerAlerts({save:vi.fn(),send});alerts.update('connection',true);await Promise.resolve();alerts.update('connection',false);
  done({enabled:true});await alerts.flush();await alerts.flush();expect(send).toHaveBeenCalledTimes(2);
});
it('authenticates monitor requests before any database operation',async()=>{
  const fetcher=fakeFetch(),handler=createAlertHandler(env,fetcher);
  expect((await handler(request({action:'monitor'}))).status).toBe(401);expect(fetcher).not.toHaveBeenCalled();
  expect((await handler(request({action:'monitor'},{'x-monitor-secret':'MONITOR_SECRET'}))).status).toBe(200);
});
it('restricts worker reports to their organization and uses provider idempotency',async()=>{
  const fetcher=fakeFetch(),handler=createAlertHandler(env,fetcher);
  expect((await handler(request({action:'report',worker_id:'worker',token:'WORKER_SECRET',events:[{category:'connection',failed:true}],organization_id:'other'}))).status).toBe(200);
  const claim=fetcher.mock.calls.find(([url])=>String(url).endsWith('message_alert_claim'))!;expect(JSON.parse(String(claim[1]?.body)).p_organization_id).toBe('org');
  const email=fetcher.mock.calls.find(([url])=>url==='https://api.resend.com/emails')!;expect((email[1]?.headers as Record<string,string>)['Idempotency-Key']).toBe('whatsapp-alert/delivery');
  expect(String(email[1]?.body)).not.toContain('WORKER_SECRET');expect(String(email[1]?.body)).not.toContain('SERVER_SECRET');
});
it('records safe provider failures and does not claim successful delivery',async()=>{
  const fetcher=fakeFetch({providerError:true}),handler=createAlertHandler(env,fetcher);
  const response=await handler(request({action:'monitor'},{'x-monitor-secret':'MONITOR_SECRET'}));
  const result=await response.json();expect(result.failed).toBe(1);expect(JSON.stringify(result)).not.toContain('PRIVATE');
  const complete=fetcher.mock.calls.find(([url])=>String(url).endsWith('message_alert_complete'))!;expect(JSON.parse(String(complete[1]?.body))).toMatchObject({p_provider_id:null,p_error_code:'provider_unreachable'});
});
it('validates organization administrator access and refuses unconfigured test delivery',async()=>{
  const fetcher=fakeFetch(),handler=createAlertHandler({...env,resendKey:undefined},fetcher);
  expect((await handler(request({action:'test',organization_id:'org'}))).status).toBe(401);
  expect((await handler(request({action:'test',organization_id:'org'},{authorization:'Bearer USER_JWT'}))).status).toBe(503);
  expect(fetcher.mock.calls.some(([url])=>url==='https://api.resend.com/emails')).toBe(false);
});
it('keeps email content safe and explains uncertain delivery without suggesting automatic resend',()=>{
  const content=emailContent({...item,payload:{...item.payload,category:'delivery_unknown',body:'PRIVATE_MESSAGE',token:'PRIVATE_TOKEN'}});
  expect(content.text).toContain('before any manual resend');expect(JSON.stringify(content)).not.toContain('PRIVATE');
  expect(emailContent({...item,kind:'recovery'}).subject).toContain('Recovered');
});
it('flushes a newly queued delivery even when another report is still in flight',async()=>{
  let done!:(value:{enabled:boolean})=>void;
  const send=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{done=resolve;})).mockResolvedValue({enabled:true});
  const alerts=new WorkerAlerts({save:vi.fn(),send});alerts.update('connection',true);await Promise.resolve();
  const flush=alerts.flush(true);done({enabled:true});await flush;
  expect(send).toHaveBeenCalledTimes(2);expect(send).toHaveBeenLastCalledWith([]);
});
it('immediately follows up with a different failure detected during an in-flight report',async()=>{
  let done!:(value:{enabled:boolean})=>void;
  const send=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{done=resolve;})).mockResolvedValue({enabled:true});
  const alerts=new WorkerAlerts({save:vi.fn(),send});alerts.update('connection',true);await Promise.resolve();
  alerts.update('startup',true);done({enabled:true});await alerts.flush();
  expect(send).toHaveBeenLastCalledWith([{category:'startup',failed:true}]);
});
it('reports success for the new test even when an older queued email fails in the same batch',async()=>{
  const fetcher=fakeFetch({items:[{...item,id:'old-test'},{...item,id:'new-test',kind:'test'}],rejectId:'old-test',deliveries:[{id:'new-test',status:'sent'},{id:'old-test',status:'pending',error_code:'provider_http_403'}]});
  const result=await createAlertHandler(env,fetcher)(request({action:'test',organization_id:'org'},{authorization:'Bearer USER_JWT'}));
  expect(result.status).toBe(200);expect(await result.json()).toEqual({test:{id:'new-test',status:'sent'}});
});
it('reports queued rather than successful when the new test is being handled by another monitor',async()=>{
  const fetcher=fakeFetch({items:[],deliveries:[{id:'new-test',status:'sending'}]});
  const result=await createAlertHandler(env,fetcher)(request({action:'test',organization_id:'org'},{authorization:'Bearer USER_JWT'}));
  expect(result.status).toBe(202);expect((await result.json()).test.status).toBe('pending');
});
it('still reports a failure of the newly requested test',async()=>{
  const fetcher=fakeFetch({providerError:true,deliveries:[{id:'new-test',status:'pending',error_code:'provider_unreachable'}]});
  const result=await createAlertHandler(env,fetcher)(request({action:'test',organization_id:'org'},{authorization:'Bearer USER_JWT'}));
  expect(result.status).toBe(502);expect((await result.json()).test.status).toBe('failed');
});

it('delivers offline alerts when monitor and completion RPCs succeed with HTTP 204',async()=>{
  const fetcher=fakeFetch({emptyRpc:true});
  const result=await createAlertHandler(env,fetcher)(request({action:'monitor'},{'x-monitor-secret':'MONITOR_SECRET'}));
  expect(result.status).toBe(200);expect(await result.json()).toMatchObject({sent:1,failed:0});
});
