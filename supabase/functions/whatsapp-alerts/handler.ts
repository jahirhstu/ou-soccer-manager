type Json = Record<string, any>;
export interface AlertEnvironment { supabaseUrl:string; serviceKey:string; resendKey?:string; from?:string; monitorSecret?:string; appUrl?:string }
const descriptions:Record<string,string>={
  connection:'WhatsApp connection could not be established or was lost',compatibility:'WhatsApp browser compatibility check failed',
  coordinate:'Worker synchronization failed',commands:'Worker control processing failed',group_sync:'WhatsApp group discovery failed',
  dispatch:'Message dispatch processing failed',journal_recovery:'Delivery result recovery failed',browser_suspend:'WhatsApp browser could not pause',
  startup:'Worker startup failed',pairing_port:'Local pairing page could not start',worker_overdue:'Worker missed its expected check-in',
  delivery_failed:'WhatsApp message delivery failed',delivery_unknown:'WhatsApp message delivery is uncertain',delivery_missed:'Scheduled message was missed'
};
export function emailContent(item:Json,appUrl?:string){
  const p=item.payload??{},test=item.kind==='test',recovery=item.kind==='recovery';
  const description=descriptions[p.category]??'Worker issue';
  return {subject:`OU Soccer WhatsApp · ${test?'Test email':recovery?'Recovered':'Action required'}${test?'':` · ${description}`}`,
    text:[test?'WhatsApp worker email alerts are configured. This email does not send a WhatsApp message.':`${recovery?'Recovered':'Issue detected'}: ${description}.`,
      `Organization: ${p.organization_id}`,`Time (UTC): ${p.at}`,p.worker_id?`Worker: ${p.worker_id}`:'',p.execution_id?`Execution: ${p.execution_id}`:'',
      !test&&!recovery?'Check Communications → Connections & History and the Mac worker. Keep the Mac awake and online. Restart the worker if needed; pair again only if authentication was lost.':'',
      p.category==='delivery_unknown'?'Check the WhatsApp group before any manual resend. The worker will not automatically resend an uncertain message.':'',
      appUrl?`Open Communications: ${appUrl.replace(/\/$/,'')}/communications`:''].filter(Boolean).join('\n\n')};
}
function response(status:number,data:Json){return Response.json(data,{status});}
async function equalSecret(a:string,b:string){
  const digest=async(s:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
  const [x,y]=await Promise.all([digest(a),digest(b)]);let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;
}
export function createAlertHandler(env:AlertEnvironment,fetcher:typeof fetch=fetch){
  const rpc=async(name:string,args:Json,key=env.serviceKey)=>{
    const result=await fetcher(`${env.supabaseUrl}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:env.serviceKey,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(8000)});
    if(!result.ok)throw new Error('database_operation_failed');return result.json();
  };
  const configured=()=>!!env.resendKey&&!!env.from;
  async function deliver(org:string|null){
    if(!configured())return {sent:0,failed:0,configured:false};
    const items=await rpc('message_alert_claim',{p_organization_id:org});let sent=0,failed=0;
    for(const item of items){
      let providerId:string|null=null,errorCode:string|null=null;
      try{
        const email=await rpc('message_alert_prepare',{p_id:item.id,p_claim_id:item.claim_id,p_email:{from:env.from,to:[item.recipient],...emailContent(item,env.appUrl)}});
        if(!email)continue;
        const result=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.resendKey}`,'Content-Type':'application/json','Idempotency-Key':`whatsapp-alert/${item.id}`},body:JSON.stringify(email),signal:AbortSignal.timeout(8000)});
        if(result.ok){const body=await result.json();if(typeof body.id==='string')providerId=body.id;else errorCode='provider_invalid_response';}
        else errorCode=`provider_http_${result.status}`;
      }catch{errorCode='provider_unreachable';}
      await rpc('message_alert_complete',{p_id:item.id,p_claim_id:item.claim_id,p_provider_id:providerId,p_error_code:errorCode});
      if(providerId)sent++;else failed++;
    }
    return {sent,failed,configured:true};
  }
  return async(request:Request):Promise<Response>=>{
    if(request.method!=='POST')return response(405,{error:'POST required'});
    let queuedTest:string|undefined;
    try{
      const raw=await request.text();if(raw.length>16000)return response(413,{error:'Request too large'});
      let body:Json;try{body=JSON.parse(raw);}catch{return response(400,{error:'Invalid JSON'});}
      if(!body||typeof body!=='object')return response(400,{error:'Invalid request'});
      if(body.action==='monitor'){
        const secret=request.headers.get('x-monitor-secret')??'';
        if(!env.monitorSecret||!secret||!await equalSecret(secret,env.monitorSecret))return response(401,{error:'Unauthorized'});
        await rpc('message_alert_monitor',{});return response(200,await deliver(null));
      }
      if(body.action==='report'){
        if(typeof body.worker_id!=='string'||typeof body.token!=='string'||!Array.isArray(body.events)||body.events.length>30)return response(400,{error:'Invalid worker report'});
        let result:Json;
        try{result=await rpc('message_alert_report',{p_worker_id:body.worker_id,p_token:body.token,p_events:body.events});}catch{return response(403,{error:'Worker report rejected'});}
        // A worker can only flush its own organization's emails.
        return response(200,{enabled:result.enabled,...await deliver(result.organization_id)});
      }
      if(!['status','test','check'].includes(body.action)||typeof body.organization_id!=='string')return response(400,{error:'Unknown action'});
      const bearer=request.headers.get('authorization')??'';
      if(!bearer.startsWith('Bearer '))return response(401,{error:'Unauthorized'});
      const token=bearer.slice(7);
      // The administrator RPC validates auth.uid() and organization role using the caller's JWT.
      try{await rpc('message_alert_admin',{p_organization_id:body.organization_id,p_operation:'status'},token);}catch{return response(403,{error:'Organization administrator required'});}
      if(body.action==='status')return response(200,{senderConfigured:configured(),monitorConfigured:!!env.monitorSecret});
      if(!configured())return response(503,{error:'Configure Resend and the verified sender in Edge Function secrets first'});
      if(body.action==='test'){
        try{const test=await rpc('message_alert_admin',{p_organization_id:body.organization_id,p_operation:'test'},token);queuedTest=test.id;}catch{return response(400,{error:'Save a recipient first and wait one minute between test emails'});}
      }else await rpc('message_alert_monitor',{p_organization_id:body.organization_id});
      const result=await deliver(body.organization_id);
      if(body.action==='test'){
        const status=await rpc('message_alert_admin',{p_organization_id:body.organization_id,p_operation:'status'},token);
        const test=status.deliveries?.find((entry:Json)=>entry.id===queuedTest);
        if(test?.status==='sent')return response(200,{test:{id:queuedTest,status:'sent'}});
        if(test?.error_code||test?.status==='failed'||test?.status==='cancelled')return response(502,{error:'Test email delivery failed; check its delivery status',test:{id:queuedTest,status:'failed'}});
        return response(202,{test:{id:queuedTest,status:'pending'}});
      }
      return response(result.failed?502:200,result.failed?{error:'Email delivery failed; check the delivery status',...result}:result);
    }catch{
      if(queuedTest)return response(202,{test:{id:queuedTest,status:'pending'}});
      return response(503,{error:'Alert service unavailable; queued emails will be retried by the monitor'});
    }
  };
}
