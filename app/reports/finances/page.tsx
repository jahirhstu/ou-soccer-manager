import Link from 'next/link';
import { getScopedPath } from '@/lib/tenant-server';
import { AppShell } from '../../(shell)';
import { loadCashReport } from '@/lib/cash-report-server';
import type { CashFilters } from '@/lib/cash-report';
import { money } from '@/lib/utils';

export default async function FinancialReport({ searchParams }: { searchParams: Promise<CashFilters> }) {
  const input = await searchParams;
  const reportPath = await getScopedPath("/reports/finances");
  let result: Awaited<ReturnType<typeof loadCashReport>>;
  try { result = await loadCashReport(input); }
  catch (error) { return <AppShell><h1 className="page-title">Financial report</h1><p role="alert" className="mt-4 text-rose-700">{error instanceof Error ? error.message : 'Cash report is unavailable.'}</p><Link className="btn-secondary mt-4" href={reportPath}>Reset report</Link></AppShell>; }
  const { report, filters, program, supabase } = result;
  const { data: seasons, error } = await supabase.from('seasons').select('id,name').eq('program_id', program.id).order('start_date', { ascending: false });
  if (error) throw new Error(error.message);
  const params = new URLSearchParams({ from: filters.from, to: filters.to, season: filters.season, pageSize: String(filters.pageSize) });
  const pageHref = (page: number) => `${reportPath}?${params}&page=${page}`;
  const pages = Math.max(1, Math.ceil(report.count / filters.pageSize));
  const state = (amount: number) => Number(amount) < 0 ? 'Deficit' : Number(amount) > 0 ? 'Positive cash balance' : 'Balanced';
  const amount = (value: number) => money(Number(value));
  return <AppShell>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h1 className="page-title">Financial report</h1><a className="btn-secondary" href={`${reportPath}/export?${params}`}>Export full report CSV</a></div>
    <p className="mb-2 text-sm text-slate-600">Follow money received and spent in {program.name ?? 'this program'}. Cash includes unused player funds. A positive balance does not necessarily mean profit.</p>
    <p className="mb-5 text-xs text-slate-500">Uses transaction dates, not the date they were entered. Backdated changes can update historical balances. All seasons excludes internal season transfers.</p>
    <form className="panel mb-5 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
      <label className="text-sm">From date<input className="input mt-1" type="date" name="from" defaultValue={filters.from} required /></label>
      <label className="text-sm">To date<input className="input mt-1" type="date" name="to" defaultValue={filters.to} required /></label>
      <label className="text-sm">Season<select className="input mt-1" name="season" defaultValue={filters.season}><option value="">All seasons</option>{(seasons ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label className="text-sm">Transactions per page<select className="input mt-1" name="pageSize" defaultValue={filters.pageSize}>{[10,25,50].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      <button className="btn-primary self-end justify-center">Apply</button>
    </form>
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
      ['Opening Cash Balance', report.opening, 'Balance from transactions before the From date.'],
      ['Money In', report.money_in, 'Incoming money within the selected dates.'],
      ['Money Out', report.money_out, 'Outgoing money within the selected dates.'],
      ['Closing Cash Balance', report.closing, 'Opening balance plus money in minus money out.']
    ].map(([label, value, description]) => <section className="panel p-4" key={String(label)}><h2 className="text-sm font-semibold text-slate-600">{label}</h2><p className="mt-2 text-2xl font-semibold">{amount(Number(value))}</p>{(label === 'Opening Cash Balance' || label === 'Closing Cash Balance') && <p className={Number(value) < 0 ? 'text-rose-700' : 'text-slate-600'}>{state(Number(value))}</p>}<p className="mt-1 text-xs text-slate-500">{description}</p></section>)}</div>
    <div className="mb-3 flex flex-wrap justify-between gap-2 text-sm"><span>Opening balance before {filters.from}</span><strong>{amount(report.opening)} · {state(report.opening)}</strong></div>
    {!report.rows.length && <p className="panel p-6 text-center text-slate-600">No cash transactions in this date range. The opening balance carries forward.</p>}
    {!!report.rows.length && <>
      <div className="hidden md:block panel"><table className="w-full table-fixed text-left text-sm"><thead className="border-b border-line bg-slate-50"><tr>{['No.', 'Date', 'Particulars', 'In', 'Out', 'Running Cash Balance'].map(h => <th scope="col" className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{report.rows.map(row => <tr key={row.id} className="border-b border-line [&>td]:break-words [&>td]:p-3 [&>td]:align-top"><td>{row.number}</td><td>{row.date}</td><td><span className="font-semibold">{row.particulars}</span><p className="text-xs text-slate-500">{row.season}</p><p className="mt-1 text-xs text-slate-600">{row.description}</p></td><td>{Number(row.money_in) ? amount(row.money_in) : '—'}</td><td>{Number(row.money_out) ? amount(row.money_out) : '—'}</td><td className={Number(row.balance) < 0 ? 'text-rose-700' : ''}><strong>{amount(row.balance)}</strong><p className="text-xs">{state(row.balance)}</p></td></tr>)}</tbody></table></div>
      <div className="grid gap-3 md:hidden">{report.rows.map(row => <article className="panel min-w-0 p-4" key={row.id}><p className="text-xs text-slate-500">#{row.number} · {row.date} · {row.season}</p><h2 className="mt-1 break-words font-semibold">{row.particulars}</h2><p className="mt-1 break-words text-sm text-slate-600">{row.description}</p><dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt>In</dt><dd>{amount(row.money_in)}</dd></div><div><dt>Out</dt><dd>{amount(row.money_out)}</dd></div><div className="col-span-2"><dt>Running Cash Balance</dt><dd className={Number(row.balance) < 0 ? 'font-semibold text-rose-700' : 'font-semibold'}>{amount(row.balance)} · {state(row.balance)}</dd></div></dl></article>)}</div>
    </>}
    <div className="mt-3 flex flex-wrap justify-between gap-2 border-t border-line py-3 text-sm"><span>Closing balance through {filters.to}</span><strong>{amount(report.closing)} · {state(report.closing)}</strong></div>
    <nav aria-label="Cash report pages" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"><p>Showing {report.count ? (report.page-1)*filters.pageSize+1 : 0}–{Math.min(report.page*filters.pageSize,report.count)} of {report.count} transactions</p><div className="flex items-center gap-3">{report.page > 1 ? <Link className="btn-secondary" href={pageHref(report.page-1)}>Previous</Link> : <span aria-disabled="true" className="text-slate-400">Previous</span>}<span>Page {report.page} of {pages}</span>{report.page < pages ? <Link className="btn-secondary" href={pageHref(report.page+1)}>Next</Link> : <span aria-disabled="true" className="text-slate-400">Next</span>}</div></nav>
  </AppShell>;
}
