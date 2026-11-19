'use client';
import { useState } from 'react';
export interface WorkerAlertData {
  settings:{recipient:string;enabled:boolean;test_succeeded_at:string|null}|null;
  open_incidents:Array<{category:string;execution_id:string|null;opened_at:string}>;
  deliveries:Array<{id:string;kind:string;status:string;created_at:string;error_code:string|null}>;
}
export function WorkerEmailAlerts({alerts,sender,pending,onMutate}:{alerts:WorkerAlertData|null;sender:{senderConfigured:boolean;monitorConfigured:boolean}|null;pending:boolean;onMutate:(operation:string,payload:Record<string,unknown>)=>void}){
  const [alertEmail,setAlertEmail]=useState(alerts?.settings?.recipient??'');
  const time=(value:string)=>new Date(value).toLocaleString();
  return (<section className="panel grid gap-3 p-5" aria-labelledby="worker-email-alerts">
        <h2 id="worker-email-alerts" className="section-title">Worker email alerts</h2>
        <p className="text-sm">Receive one failure email and one recovery email per incident. Worker errors report immediately; offline alerts follow the expected check-in allowance. Intentional idle pauses do not alert.</p>
        <p className="text-sm">Alerts: {alerts?.settings?.enabled ? 'Enabled' : 'Disabled'} · Sender: {sender?.senderConfigured ? 'Configured' : 'Setup required'} · Monitor setup: {sender?.monitorConfigured ? 'Configured (scheduled job must also be installed)' : 'Setup required'}</p>
        <form className="flex flex-wrap items-end gap-3" onSubmit={event=>{event.preventDefault();onMutate('alert_save',{recipient:alertEmail});}}>
          <label className="grid gap-1 text-sm font-medium">Recipient email<input type="email" required maxLength={254} className="input" value={alertEmail} onChange={event=>setAlertEmail(event.target.value)}/></label>
          <button className="btn-secondary" disabled={pending}>Save recipient</button>
        </form>
        <p className="text-xs">Changing the recipient disables alerts until a test email to the new address succeeds. Verify the test arrives before enabling alerts.</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" disabled={pending||!alerts?.settings?.recipient||!sender?.senderConfigured} onClick={()=>onMutate('alert_test',{})}>Send test email</button>
          <button className="btn-primary" disabled={pending||(!alerts?.settings?.enabled&&(!alerts?.settings?.test_succeeded_at||!sender?.senderConfigured||!sender?.monitorConfigured))} onClick={()=>onMutate('alert_enable',{enabled:!alerts?.settings?.enabled})}>{alerts?.settings?.enabled?'Disable alerts':'Enable alerts'}</button>
        </div>
        {(alerts?.open_incidents??[]).map((incident:{category:string;execution_id:string|null;opened_at:string})=><p key={`${incident.category}:${incident.execution_id}`} className="text-sm text-amber-800">Open issue: {incident.category} · {time(incident.opened_at)}{incident.execution_id?` · Execution ${incident.execution_id}`:''}</p>)}
        <details className="text-xs"><summary className="cursor-pointer font-medium">Email delivery history ({alerts?.deliveries?.length??0})</summary><p className="my-2">Saved attempts remain here after refresh. An older failed test does not change the result of a newer test.</p><ul className="mt-2 space-y-1">{(alerts?.deliveries??[]).map((delivery:{id:string;kind:string;status:string;created_at:string;error_code:string|null})=><li key={delivery.id}>{delivery.kind} email · {delivery.status==='sent'?'accepted by provider':delivery.status} · {time(delivery.created_at)}{delivery.error_code?` · ${delivery.error_code}`:''}</li>)}</ul></details>
        {!sender?.senderConfigured&&<p className="text-xs">Set up Resend, verify a sending domain, and configure the Edge Function sender secrets using the WhatsApp scheduler deployment guide.</p>}
      </section>);
}
