"use client";

import { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import { refreshStatus, requestRefresh } from '@/lib/actions/production-refresh';
import type { RefreshJob } from '@/lib/production-refresh';

export function ProductionRefresh({ organizationName }: { organizationName: string }) {
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<RefreshJob[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const current = jobs[0];
  useEffect(() => setConfirmed(false), [current?.id]);
  const active = current && ['analyze_queued','analyzing','preview_ready','apply_queued','applying'].includes(current.status);
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    let disposed = false;
    async function poll() {
      const result = await refreshStatus();
      if (!disposed) { setJobs(result.jobs ?? []); if (result.error) setError(result.error); }
    }
    void poll();
    const interval = setInterval(() => void poll(), 4000);
    return () => { disposed = true; clearInterval(interval); };
  }, [open]);
  async function act(command: string) {
    setBusy(true); setError('');
    try {
      const result = await requestRefresh(command, command === 'analyze' ? undefined : current?.id);
      if (result.error) setError(result.error);
      const status = await refreshStatus(); setJobs(status.jobs ?? []); setConfirmed(false);
    } catch { setError('Could not reach the server. Check refresh history before retrying.'); }
    finally { setBusy(false); }
  }
  return <>
    <button className="btn-secondary" onClick={() => setOpen(true)}><Download className="h-4 w-4" /> Refresh From Production</button>
    {open && <dialog ref={dialog} aria-labelledby="refresh-title" onCancel={() => setOpen(false)} className="w-[calc(100%-2rem)] max-w-xl rounded-lg bg-white p-0 shadow-xl backdrop:bg-black/40">
      <section className="max-h-[90vh] w-full overflow-y-auto p-5">
        <div className="flex items-center justify-between gap-3"><h2 id="refresh-title" className="text-lg font-semibold">Refresh From Production</h2>
          <button aria-label="Close" title="Close" onClick={() => setOpen(false)}><X className="h-5 w-5" /></button></div>
        <p className="mt-3 text-sm text-slate-600">Production to development. This organization only. Development accounts, access permissions, and program settings are retained.</p>
        <p className="mt-2 text-sm font-semibold">{organizationName}</p>
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        {current && <p className="mt-4 text-sm font-medium" role="status">{current.status.replaceAll('_', ' ')}{current.error ? `: ${current.error}` : ''}</p>}
        {current?.status === 'preview_ready' && <>
          <table className="mt-3 w-full text-sm"><thead><tr className="border-b text-left"><th>Records</th><th className="text-right">Production</th><th className="text-right">Development</th></tr></thead>
            <tbody>{current.preview?.map(row => <tr key={row.table} className="border-b"><td className="py-1">{row.table.replaceAll('_',' ')}</td><td className="text-right">{row.production}</td><td className="text-right">{row.development}</td></tr>)}</tbody></table>
          <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I understand that this organization's development activity and financial data will be replaced, including development-only changes.</label>
          <button className="btn-primary mt-3" disabled={busy || !confirmed} onClick={() => void act('confirm')}><RefreshCw className="h-4 w-4" /> Confirm Refresh</button>
        </>}
        {!active && <button className="btn-primary mt-4" disabled={busy} onClick={() => void act('analyze')}><RefreshCw className="h-4 w-4" /> Analyze Changes</button>}
        {current && ['analyze_queued','preview_ready','apply_queued'].includes(current.status) && <button className="btn-secondary ml-2 mt-3" disabled={busy} onClick={() => void act('cancel')}>Cancel Request</button>}
        {jobs.length > 1 && <div className="mt-5 border-t pt-3 text-sm"><h3 className="font-semibold">Recent Refreshes</h3>{jobs.slice(1).map(job => <p key={job.id} className="mt-1">{new Date(job.created_at).toLocaleString()} - {job.status.replaceAll('_',' ')}</p>)}</div>}
      </section>
    </dialog>}
  </>;
}
