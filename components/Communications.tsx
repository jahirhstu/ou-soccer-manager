'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { CalendarDays, FileText, Radio, RefreshCw } from 'lucide-react';
import { communicationsData, communicationsStatus, communicationsMutation } from '@/lib/actions/communications';
import { WorkerEmailAlerts } from './WorkerEmailAlerts';
import { upcoming, renderMessage, type ScheduleInput } from '@ou/communications';

type Data = Awaited<ReturnType<typeof communicationsData>>;
const blank: ScheduleInput = { name: '', body: '', destination_id: null, frequency: 'weekly', timezone: 'America/Toronto', local_time: '21:00:00', local_date: null, weekdays: [1], venue: 'Bell Sensplex', match_time: '7 AM – 9 AM', enabled: false };
function dates(schedule: ScheduleInput) { try { return upcoming(schedule); } catch { return []; } }
function time(value: string | null | undefined) { return value ? new Date(value).toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, timeZoneName: 'short' }) : '—'; }
export function Communications({ initial }: { initial: Data }) {
  const [data, setData] = useState(initial);
  const refreshing = useRef(false), deferredFullRefresh = useRef(false);
  const refreshRef = useRef<(full?: boolean) => Promise<void>>(async () => {});
  const [tab, setTab] = useState('schedules');
  const [schedule, setSchedule] = useState<ScheduleInput & { id?: string }>(blank);
  const [editing, setEditing] = useState(false);
  const [template, setTemplate] = useState({ id: '', name: '', body: '' });
  const [credentials, setCredentials] = useState<Record<string, string> | null>(null);
  const [pending, transition] = useTransition();
  const [now, setNow] = useState(Date.now());
  const [confirmation, setConfirmation] = useState<{ title: string; detail: string; operation: string; payload: Record<string, unknown> } | null>(null);
  useEffect(() => {
    if (!confirmation) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[aria-labelledby="communication-confirm"]');
    dialog?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => previous?.focus();
  }, [confirmation]);
  async function refresh(full = true) {
    if (refreshing.current) { if (full) deferredFullRefresh.current = true; return; }
    refreshing.current = true;
    setNow(Date.now());
    try {
      if (full) { setData(await communicationsData()); return; }
      const update = await communicationsStatus(data.connection?.configuration_revision, data.connection?.work_revision, tab === 'connections');
      if (update.configurationChanged) { setData(await communicationsData()); return; }
      setData(current => ({ ...current, connection: update.connection, alerts: update.alerts ?? current.alerts, executions: update.executions ?? current.executions }));
    } catch { /* Keep the last known state and let its heartbeat age visibly. */ }
    finally { refreshing.current = false; if (deferredFullRefresh.current) { deferredFullRefresh.current = false; void refreshRef.current(true); } }
  }
  refreshRef.current = refresh;
  useEffect(() => {
    const poll = () => { if (!document.hidden) void refreshRef.current(false); };
    const idle = data.connection?.worker_mode === 'idle';
    const nextCheck = Date.parse(data.connection?.next_check_at ?? '');
    const interval = idle ? Math.min(3600000, Math.max(30000, Number.isFinite(nextCheck) ? nextCheck - Date.now() + 1000 : 3600000)) : 30000;
    const timer = setInterval(poll, interval);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    document.addEventListener('visibilitychange', poll);
    window.addEventListener('focus', poll);
    if (tab === 'connections' && !document.hidden) void refreshRef.current(true);
    return () => { clearInterval(timer); clearInterval(clock); document.removeEventListener('visibilitychange', poll); window.removeEventListener('focus', poll); };
  }, [tab, data.connection?.worker_mode, data.connection?.next_check_at]);
  function mutate(operation: string, payload: Record<string, unknown>, after?: () => void) {
    transition(async () => {
      const result = await communicationsMutation(operation, payload);
      if (result.error) { toast.error(result.error); if (operation.startsWith('alert_')) await refresh(); return; }
      if (operation === 'provision' && 'result' in result) setCredentials(result.result);
      toast.success(operation === 'alert_test' ? ('testEmailStatus' in result && result.testEmailStatus === 'sent' ? 'Test email accepted by the email provider; check your inbox' : 'Test email queued; delivery is not yet confirmed. Refresh delivery history shortly.') : operation === 'test' ? 'Test queued; expires in 60 seconds' : operation === 'refresh_groups' ? 'Group refresh requested; allow up to 30 seconds' : ['schedule', 'delete_schedule', 'automation', 'setup'].includes(operation) ? 'Saved. Changes apply at the next worker check; restart the Mac worker to apply sooner.' : 'Saved');
      after?.(); await refresh();
    });
  }
  const next = dates(schedule);
  let preview = '', previewError = '';
  try { preview = renderMessage(schedule.body, next[0] ?? new Date().toISOString(), schedule.timezone, schedule); }
  catch (error) { previewError = error instanceof Error ? error.message : 'Invalid message'; }
  let templatePreview = '';
  try { templatePreview = renderMessage(template.body, new Date().toISOString(), blank.timezone, blank); } catch (error) { templatePreview = error instanceof Error ? error.message : 'Invalid template'; }
  const connection = data.connection;
  const idle = connection?.worker_mode === 'idle';
  const heartbeatSeconds = idle ? 3600 : connection?.heartbeat_interval_seconds === 30 ? 30 : 10;
  const healthy = idle
    ? now < Date.parse(connection?.lease_until ?? '') && now < Date.parse(connection?.next_check_at ?? '') + 300000
    : connection?.state !== 'offline' && !!connection?.heartbeat_at && now - Date.parse(connection.heartbeat_at) < heartbeatSeconds * 3000;
  const ready = healthy && !idle && connection?.state === 'ready';
  const pendingSync = !!connection?.adaptive_coordination && String(connection.configuration_revision) !== String(connection.acknowledged_configuration_revision ?? '');
  const workerStatus = !healthy ? 'Check-in overdue' : idle ? 'Idle' : 'Active';
  return <div className="grid gap-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm text-slate-500">Admin · Communications</p><h1 className="page-title">Message Scheduler</h1></div><button type="button" className="btn-secondary" onClick={() => void refresh(true)}><RefreshCw size={16} /> Refresh</button></div>
    <p className="text-sm text-slate-600">Automatic posting uses your Mac. Keep it powered on, awake, and online. Unofficial WhatsApp integration may lead to account restrictions.</p>
    {connection && <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm" role="status">
      <p>{workerStatus} · WhatsApp: {idle ? 'paused; saved login retained' : connection.state}. Next check: {time(connection.next_check_at)}.</p>
      {pendingSync && <p className="mt-2 font-medium">Configuration changes are awaiting worker synchronization.</p>}
      <p className="mt-2">Changes are picked up at the next worker check. Restart the Mac worker to apply them sooner: <code>npx --yes pnpm@11.9.0 whatsapp restart</code>.</p>
      {idle && <p className="mt-2">Restart for tests, pairing, or an immediate group refresh. Restarting opens a 30-minute active window. A new schedule may miss its sending time if the worker has not synchronized.</p>}
    </div>}
    <nav className="flex flex-wrap gap-2" aria-label="Communications views">{[['schedules','Schedules',CalendarDays],['templates','Templates',FileText],['connections','Connections & History',Radio]].map(([key,label,Icon]) => { const TabIcon = Icon as typeof Radio; return <button key={String(key)} className={tab===key?'btn-primary':'btn-secondary'} onClick={() => setTab(String(key))}><TabIcon size={16}/>{String(label)}</button>; })}</nav>
    {tab === 'schedules' && <>
      <div className="flex gap-2"><button className="btn-primary" onClick={() => { setSchedule(blank); setEditing(true); }}>New schedule</button><button disabled={pending} className="btn-secondary" onClick={() => mutate('setup', {})}>Add weekly signup defaults</button></div>
      {data.schedules.map(s => <section className="panel grid gap-3 p-5" key={s.id}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="section-title">{s.name}</h2><span>{s.enabled ? 'Enabled' : 'Disabled'}</span></div>
        <p className="text-sm">{s.frequency} · {s.local_time} · {s.timezone} · {data.destinations.find(d=>d.id===s.destination_id)?.name ?? 'Select a group'}</p>
        <p className="text-xs text-slate-500">Upcoming: {dates(s).map(d=>new Date(d).toLocaleString('en-CA',{timeZone:s.timezone,timeZoneName:'shortOffset'})).join(' · ') || 'No future executions'}</p>
        <div className="flex gap-2"><button className="btn-secondary" onClick={() => { setSchedule(s); setEditing(true); }}>Edit / preview</button><button disabled={pending} className="btn-secondary" onClick={() => mutate('schedule', { ...s, enabled: !s.enabled })}>{s.enabled?'Disable':'Enable'}</button><button className="btn-secondary" onClick={() => setConfirmation({title:'Delete schedule?',detail:s.name,operation:'delete_schedule',payload:{id:s.id}})}>Delete</button></div>
      </section>)}
      {!data.schedules.length && <p className="panel p-5">Create a schedule or add the disabled weekly signup defaults.</p>}
      {editing && <form className="panel grid gap-4 p-5" onSubmit={e => { e.preventDefault(); mutate('schedule', schedule, () => setEditing(false)); }}>
        <h2 className="section-title">{schedule.id?'Edit':'Create'} schedule</h2>
        <label className="grid gap-1 text-sm font-medium text-slate-700">Name<input required className="input w-full mt-1" value={schedule.name} maxLength={120} onChange={e=>setSchedule({...schedule,name:e.target.value})}/></label>
        <label className="grid gap-1 text-sm font-medium text-slate-700">Use template<select className="input w-full mt-1" defaultValue="" onChange={e=>{const t=data.templates.find(t=>t.id===e.target.value);if(t)setSchedule({...schedule,body:t.body});}}><option value="">Choose a template or write below</option>{data.templates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-medium text-slate-700">Message<textarea required className="input w-full mt-1 min-h-64" value={schedule.body} maxLength={10000} onChange={e=>setSchedule({...schedule,body:e.target.value})}/></label>
        <p className="text-xs text-slate-500">Variables: {'{{next_sunday_date}}, {{venue}}, {{match_time}}'}</p>
        <label className="grid gap-1 text-sm font-medium text-slate-700">WhatsApp group<select required={schedule.enabled} className="input w-full mt-1" value={schedule.destination_id??''} onChange={e=>setSchedule({...schedule,destination_id:e.target.value||null})}><option value="">Choose a discovered group</option>{data.destinations.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-medium text-slate-700">Frequency<select className="input w-full mt-1" value={schedule.frequency} onChange={e=>setSchedule({...schedule,frequency:e.target.value as ScheduleInput['frequency']})}><option value="once">One-time</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label><label className="grid gap-1 text-sm font-medium text-slate-700">Timezone<input required className="input w-full mt-1" value={schedule.timezone} onChange={e=>setSchedule({...schedule,timezone:e.target.value})}/></label>
        <label className="grid gap-1 text-sm font-medium text-slate-700">Local time<input type="time" step="1" required className="input w-full mt-1" value={schedule.local_time} onChange={e=>setSchedule({...schedule,local_time:e.target.value.length===5?e.target.value+':00':e.target.value})}/></label>
        {schedule.frequency==='once' && <label className="grid gap-1 text-sm font-medium text-slate-700">Local date<input type="date" required className="input w-full mt-1" value={schedule.local_date??''} onChange={e=>setSchedule({...schedule,local_date:e.target.value})}/></label>}
        <label className="grid gap-1 text-sm font-medium text-slate-700">Venue<input className="input w-full mt-1" value={schedule.venue} onChange={e=>setSchedule({...schedule,venue:e.target.value})}/></label><label className="grid gap-1 text-sm font-medium text-slate-700">Match time<input className="input w-full mt-1" value={schedule.match_time} onChange={e=>setSchedule({...schedule,match_time:e.target.value})}/></label></div>
        {schedule.frequency==='weekly' && <fieldset className="flex flex-wrap gap-3"><legend>Weekdays</legend>{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((day,i)=><label key={day} className="flex items-center gap-1"><input type="checkbox" checked={schedule.weekdays.includes(i+1)} onChange={e=>setSchedule({...schedule,weekdays:e.target.checked?[...schedule.weekdays,i+1]:schedule.weekdays.filter(d=>d!==i+1)})}/>{day}</label>)}</fieldset>}
        <label className="flex gap-2"><input type="checkbox" checked={schedule.enabled} onChange={e=>setSchedule({...schedule,enabled:e.target.checked})}/>Enable schedule (connection automation must also be on)</label>
        <div><h3 className="font-semibold">Preview · {next[0] ? new Date(next[0]).toLocaleString('en-CA',{timeZone:schedule.timezone,timeZoneName:'shortOffset'}) : 'Current date'}</h3><pre className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm">{previewError||preview}</pre></div>
        <div className="flex flex-wrap gap-2"><button disabled={pending} className="btn-primary">Save schedule</button><button type="button" className="btn-secondary" disabled={pending||!!previewError||!schedule.destination_id||!ready} onClick={()=>{let text='';try{text=renderMessage(schedule.body,new Date().toISOString(),schedule.timezone,schedule);}catch{return;}setConfirmation({title:'Send a real WhatsApp test?',detail:`Destination: ${data.destinations.find(d=>d.id===schedule.destination_id)?.name}\n\n${text}`,operation:'test',payload:{...schedule,body:text,confirmed:true}});}}>Send test…</button><button type="button" className="btn-secondary" onClick={()=>setEditing(false)}>Close</button></div>
      </form>}
    </>}
    {tab==='templates' && <>
      {data.templates.map(t=><section key={t.id} className="panel flex items-center justify-between gap-3 p-5"><h2 className="font-semibold">{t.name}</h2><button className="btn-secondary" onClick={()=>setTemplate(t)}>Edit</button></section>)}
      <form className="panel grid gap-3 p-5" onSubmit={e=>{e.preventDefault();mutate('template',{...template,id:template.id||undefined},()=>setTemplate({id:'',name:'',body:''}));}}><h2 className="section-title">{template.id?'Edit':'New'} template</h2><label className="grid gap-1 text-sm font-medium text-slate-700">Name<input required className="input w-full" value={template.name} onChange={e=>setTemplate({...template,name:e.target.value})}/></label><label className="grid gap-1 text-sm font-medium text-slate-700">Message<textarea required className="input w-full min-h-64" value={template.body} onChange={e=>setTemplate({...template,body:e.target.value})}/></label><p className="text-xs">Preview below uses today, Bell Sensplex and 7–9 AM. Use the schedule editor for the execution date and your values. Schedules retain their saved message when a template changes.</p><pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm">{templatePreview}</pre><div className="flex gap-2"><button disabled={pending} className="btn-primary">Save template</button><button type="button" className="btn-secondary" onClick={()=>setTemplate({id:'',name:'',body:''})}>New template</button></div></form>
    </>}
    {tab==='connections' && <>
      <WorkerEmailAlerts key={data.alerts?.settings?.recipient??'unset'} alerts={data.alerts} sender={data.alertSender} pending={pending} onMutate={mutate}/>
      <section className="panel grid gap-3 p-5"><h2 className="section-title">WhatsApp connection</h2><p>{workerStatus} · WhatsApp {idle?'paused':connection?.state} · Compatibility {connection?.compatible?'passed':'not verified'} · Automatic sending {connection?.automatic_enabled?'ON':'OFF'}</p><p className="text-sm">Check-in interval ({idle ? 'hourly while idle' : `${heartbeatSeconds} seconds while active`}): {time(connection?.heartbeat_at)}. Pair on this Mac with <code>pnpm whatsapp pair</code>. The local page displays the QR code; refresh here after scanning.</p><div className="flex flex-wrap gap-2"><button disabled={pending} className="btn-secondary" onClick={()=>setConfirmation({title:connection?'Replace worker credential?':'Provision worker?',detail:'A new private credential will be displayed once. Replacing it disables automation and revokes the previous worker.',operation:'provision',payload:{}})}>{connection?'Replace credential…':'Provision worker…'}</button><button disabled={pending||!connection} className="btn-secondary" onClick={()=>mutate('reconnect',{})}>Reconnect</button><button disabled={pending||!connection} className="btn-secondary" onClick={()=>setConfirmation({title:'Disconnect WhatsApp?',detail:'Automatic sending will be disabled and the worker will log out.',operation:'disconnect',payload:{}})}>Disconnect…</button><button disabled={pending||!connection} className="btn-primary" onClick={()=>setConfirmation({title:connection?.automatic_enabled?'Disable automatic sending?':'Activate automatic sending?',detail:'Enabled schedules will post automatically to their selected groups while this Mac is awake and connected.',operation:'automation',payload:{enabled:!connection?.automatic_enabled}})}>{connection?.automatic_enabled?'Disable automatic sending…':'Activate automatic sending…'}</button></div>
      {credentials && <div className="rounded-lg border border-amber-300 p-4"><p className="font-semibold">Save privately on your Mac now. This credential is shown once.</p><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({worker_id:credentials.worker_id,token:credentials.token},null,2)}</pre><button className="btn-secondary mt-2" onClick={()=>setCredentials(null)}>Dismiss credential</button></div>}
      <button disabled={pending||!ready} className="btn-secondary w-fit" onClick={()=>mutate('refresh_groups',{})}>Refresh WhatsApp groups</button><p className="text-xs">While active, groups refresh every 15 minutes and requested actions normally arrive within 30 seconds. While idle, controls wait until the next check; restart for immediate use.</p><p className="text-xs">Available groups: {data.destinations.map(d=>d.name).join(', ')||'None discovered'}</p></section>
      <section className="panel overflow-x-auto p-5"><h2 className="section-title mb-3">Execution history · latest 100</h2><table className="w-full text-left text-sm"><thead><tr>{['Scheduled','Dispatched','Acknowledged','Status','Latency (ms)','Details'].map(h=><th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{data.executions.map(e=><tr className="border-t" key={e.id}><td className="p-2">{time(e.scheduled_at)}{e.is_test?' (test)':''}</td><td className="p-2">{time(e.dispatch_at)}</td><td className="p-2">{time(e.acknowledgement_at)}</td><td className="p-2">{e.status} · {e.phase}</td><td className="p-2">{e.latency_ms??'—'}</td><td className="p-2">{e.error||e.provider_message_id||'—'}</td></tr>)}</tbody></table>{!data.executions.length&&<p>No executions yet.</p>}</section>
    </>}
    {confirmation && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><section onKeyDown={event => { if(event.key === "Escape" && !pending) setConfirmation(null); if(event.key === "Tab") { const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"); const first = buttons[0], last = buttons[buttons.length - 1]; if(event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if(!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } }} role="dialog" aria-modal="true" aria-labelledby="communication-confirm" className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-xl bg-white p-6 shadow-xl"><h2 id="communication-confirm" className="section-title">{confirmation.title}</h2><pre className="my-4 whitespace-pre-wrap text-sm">{confirmation.detail}</pre><div className="flex gap-3"><button disabled={pending} className="btn-primary" onClick={()=>mutate(confirmation.operation,confirmation.payload,()=>setConfirmation(null))}>Confirm</button><button disabled={pending} className="btn-secondary" onClick={()=>setConfirmation(null)}>Cancel</button></div></section></div>}
  </div>;
}
