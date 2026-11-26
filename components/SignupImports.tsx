'use client';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { signupImportData, signupImportMutation } from '@/lib/actions/signup-import';
import type { SignupScheduleInput } from '@/packages/communications/src/signup-import';
import type { SignupRun } from '@/lib/signup-import-service';
const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const blank: SignupScheduleInput = { name: 'Weekly signup import', season_id: '', destination_id: '', timezone: 'America/Toronto', weekday: 4,
  local_time: '20:00:00', session_weekday: 7, opening_weekday: 1, opening_time: '21:00:00', capacity: 21, enabled: false };
type Data = Awaited<ReturnType<typeof signupImportData>>;
export function SignupImports() {
  const [data, setData] = useState<Data | null>(null), [error, setError] = useState('');
  const [schedule, setSchedule] = useState<SignupScheduleInput & { id?: string }>(blank);
  const [editing, setEditing] = useState(false), [pending, start] = useTransition();
  const [reviewId, setReviewId] = useState(''), [selections, setSelections] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  async function refresh() { try { setData(await signupImportData()); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load signup imports'); } }
  useEffect(() => { void refresh(); const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 30000); return () => clearInterval(timer); }, []);
  const run = data?.runs.find(r => r.id === reviewId);
  function mutate(operation: string, payload: Record<string, unknown>, after?: (result: { playerId?: string }) => void) {
    start(async () => { const result = await signupImportMutation(operation, payload); if (result.error) { toast.error(result.error); return; }
      toast.success(operation === 'run_now' ? 'Import queued for the next worker check. If the Mac worker is idle, restart it to pick this up sooner. Review the draft before finalizing attendance.' : operation === 'rerun' ? 'Rerun queued for the worker; the new roster will require review' : 'Saved'); after?.(result); await refresh(); });
  }
  function review(value: SignupRun) { setReviewId(value.id); setSelections(value.selections ?? {}); setSearch(''); }
  return <div className="grid gap-4">
    <div className="panel grid gap-3 p-4"><h2 className="font-semibold">Scheduled signup imports</h2>
      <p className="text-sm text-slate-600">Read the latest signup at execution time, prioritize listed season members, and fill remaining spots in message order. Unresolved identities prepare a session and draft roster for review.</p>
      <p className="text-xs text-slate-500">Requires database migration 114 and an updated Mac worker configured with the website URL. Import schedules work independently of automatic outgoing messages.</p>
      <div className="flex gap-2"><button className="btn-primary" onClick={() => { setSchedule(blank); setEditing(true); }}>Add import schedule</button><button className="btn-secondary" onClick={() => void refresh()}>Refresh</button></div>
    </div>
    {error && <p role="alert" className="panel p-4 text-rose-700">{error}</p>}
    {editing && <form className="panel grid gap-3 p-4 md:grid-cols-2" onSubmit={event => { event.preventDefault(); mutate('save', schedule, () => setEditing(false)); }}>
      <label className="grid gap-1 text-sm">Name<input className="input" required value={schedule.name} onChange={e => setSchedule({ ...schedule, name: e.target.value })}/></label>
      <label className="grid gap-1 text-sm">Season<select className="input" required value={schedule.season_id} onChange={e => setSchedule({ ...schedule, season_id: e.target.value })}><option value="">Select season</option>{data?.seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label className="grid gap-1 text-sm">WhatsApp group<select className="input" required value={schedule.destination_id} onChange={e => setSchedule({ ...schedule, destination_id: e.target.value })}><option value="">Select group</option>{data?.destinations.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Timezone<input className="input" required value={schedule.timezone} onChange={e => setSchedule({ ...schedule, timezone: e.target.value })}/></label>
      <Weekday label="Execution day" value={schedule.weekday} onChange={weekday => setSchedule({ ...schedule, weekday })}/>
      <label className="grid gap-1 text-sm">Execution time<input className="input" type="time" required value={schedule.local_time.slice(0, 5)} onChange={e => setSchedule({ ...schedule, local_time: `${e.target.value}:00` })}/></label>
      <Weekday label="Session day (on or after execution)" value={schedule.session_weekday} onChange={session_weekday => setSchedule({ ...schedule, session_weekday })}/>
      <label className="grid gap-1 text-sm">Maximum confirmed players<input className="input" type="number" min={1} max={200} required value={schedule.capacity} onChange={e => setSchedule({ ...schedule, capacity: Number(e.target.value) })}/></label>
      <Weekday label="Signup opening day" value={schedule.opening_weekday} onChange={opening_weekday => setSchedule({ ...schedule, opening_weekday })}/>
      <label className="grid gap-1 text-sm">Signup opening time<input className="input" type="time" required value={schedule.opening_time.slice(0, 5)} onChange={e => setSchedule({ ...schedule, opening_time: `${e.target.value}:00` })}/></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={schedule.enabled} onChange={e => setSchedule({ ...schedule, enabled: e.target.checked })}/>Enabled</label>
      <div className="flex gap-2"><button className="btn-primary" disabled={pending}>Save schedule</button><button className="btn-secondary" type="button" onClick={() => setEditing(false)}>Cancel</button></div>
    </form>}
    {data?.schedules.map(s => <div key={s.id} className="panel grid gap-2 p-4"><div className="flex justify-between gap-2"><strong>{s.name}</strong><span>{s.enabled ? 'Enabled' : 'Disabled'}</span></div>
      <p className="text-sm">{weekdays[s.weekday - 1]} · {s.local_time} · {s.timezone} · capacity {s.capacity}</p><p className="text-sm">{data.seasons.find(v => v.id === s.season_id)?.name} · {data.destinations.find(v => v.id === s.destination_id)?.name}</p>
      <div className="flex gap-2"><button className="btn-secondary" onClick={() => { setSchedule(s as SignupScheduleInput & { id: string }); setEditing(true); }}>Edit</button><button disabled={pending} className="btn-secondary" onClick={() => mutate('save', { ...s, enabled: !s.enabled })}>{s.enabled ? 'Disable' : 'Enable'}</button><button className="btn-primary" disabled={pending || !s.enabled || data.runs.some(r => r.schedule_id === s.id && ['queued', 'reading'].includes(r.status))} title={!s.enabled ? 'Enable this schedule to run it manually' : undefined} onClick={() => { if (window.confirm('Read the latest signup now for the upcoming configured session day? This prepares a draft for review before changing attendance. The Mac worker must be running.')) mutate('run_now', { id: s.id }); }}>Run now</button></div>
    </div>)}
    <h2 className="font-semibold">Import history and review queue</h2>
    {!data?.runs.length && <p className="text-sm text-slate-500">No import runs yet.</p>}
    {data?.runs.map(value => <div key={value.id} className="panel grid gap-2 p-4"><div className="flex flex-wrap justify-between gap-2"><strong>Session {value.target_date}</strong><span>{value.status.replaceAll('_', ' ')}</span></div>
      <p className="text-xs text-slate-500">Execution: {new Date(value.scheduled_at).toLocaleString('en-CA', { timeZone: value.configuration.timezone, timeZoneName: 'short' })}</p>
      {value.error && <p className="text-sm text-amber-800">{value.error}</p>}
      {value.session_id && <a className="text-sm underline" href={`/sessions/${value.session_id}`}>Open prepared session</a>}
      <div className="flex gap-2"><button className="btn-secondary" onClick={() => review(value)}>View / review</button><button className="btn-secondary" disabled={pending || ['queued', 'reading'].includes(value.status)} onClick={() => { if (window.confirm('Read the latest signup for this session again? The new roster will require review before attendance changes.')) mutate('rerun', { id: value.id }); }}>Read latest again</button></div>
    </div>)}
    {run && <section className="panel grid gap-3 p-4" aria-label="Signup roster review"><div className="flex justify-between"><h2 className="font-semibold">Review session {run.target_date}</h2><button className="btn-secondary" onClick={() => setReviewId('')}>Close</button></div>
      <p className="text-sm">{run.status === 'imported' ? 'Imported roster' : 'Draft only: these players do not count as confirmed attendance until finalized.'}</p>
      <details><summary className="cursor-pointer text-sm font-semibold">Original WhatsApp message</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs">{run.source_message?.body ?? 'No message was selected. Check the run error and request a new read.'}</pre></details>
      {!run.source_message && Boolean(run.incoming_messages?.length) && <details><summary className="cursor-pointer text-sm font-semibold">Saved signup candidate</summary>{[...(run.incoming_messages ?? [])].sort((a, b) => b.timestamp - a.timestamp).slice(0, 1).map(message => <pre key={message.id} className="max-h-96 overflow-auto whitespace-pre-wrap border-t border-line py-3 text-xs">{message.body}</pre>)}</details>}
      {run.parsed_json?.warnings.map((warning, index) => <p key={index} className="text-sm text-amber-800">{warning}</p>)}
      {!run.parsed_json && run.status === 'needs_review' && <button className="btn-secondary" disabled={pending} onClick={() => mutate('retry_parse', { id: run.id })}>Retry saved signup with parser</button>}
      {run.parsed_json && <>
        <p className="text-sm">{run.draft?.rows.filter(r => r.status === 'confirmed').length ?? 0} proposed confirmed · {run.draft?.rows.filter(r => r.status === 'waitlisted').length ?? 0} proposed waitlisted</p>
        <label className="grid gap-1 text-sm">Filter available player choices<input className="input" value={search} onChange={e => setSearch(e.target.value)}/></label>
        {run.draft?.rows.map(row => <div className="grid gap-2 rounded border border-line p-3" key={row.name}><div className="flex justify-between gap-2"><strong>{row.name}</strong><span className={row.status === 'unresolved' ? 'text-amber-800' : 'text-slate-600'}>{row.member ? 'Season member · ' : ''}{row.status}</span></div>
          {run.status === 'needs_review' && <><select className="input" aria-label={`Match ${row.name}`} value={selections[row.name] ?? row.player_id ?? ''} onChange={e => setSelections({ ...selections, [row.name]: e.target.value })}>
            <option value="">Select a player</option><option value="__ignore__">Ignore this entry</option>
            {data?.players.filter(p => p.id === (selections[row.name] ?? row.player_id) || p.display_name.toLowerCase().includes(search.toLowerCase())).map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}
          </select>{!row.player_id && <button className="btn-secondary justify-self-start" disabled={pending} onClick={() => { if (window.confirm(`Create a new player named ${row.name}?`)) mutate('create_player', { id: run.id, name: row.name }, result => { if (result.playerId) setSelections(current => ({ ...current, [row.name]: result.playerId! })); }); }}>Create new player explicitly</button>}</>}
        </div>)}
        {run.status === 'needs_review' && <div className="flex flex-wrap gap-2"><button className="btn-secondary" disabled={pending} onClick={() => mutate('review', { id: run.id, selections })}>Save choices and recalculate</button><button className="btn-primary" disabled={pending} onClick={() => { if (window.confirm('Recalculate season priority and import confirmed players and the session waitlist?')) mutate('finalize', { id: run.id, selections }); }}>Finalize attendance</button></div>}
      </>}
    </section>}
  </div>;
}
function Weekday({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="grid gap-1 text-sm">{label}<select className="input" value={value} onChange={e => onChange(Number(e.target.value))}>{weekdays.map((day, i) => <option key={day} value={i + 1}>{day}</option>)}</select></label>;
}
