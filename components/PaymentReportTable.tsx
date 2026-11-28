"use client";

import { Fragment, useId, useState } from "react";
import { cn, money } from "@/lib/utils";

type Row = {
  player_id: string;
  season_id: string;
  player_name: string;
  season_name: string;
  report_status: string;
  [key: string]: string | number | null;
};
const labels: Record<string, string> = { owes: "Owes", credit: "Has credit", settled: "Settled", no_payment: "No payment" };

function Status({ row }: { row: Row }) {
  return <span className={cn("inline-block rounded-md px-2 py-1 text-xs font-semibold", row.report_status === "owes" ? "bg-rose-100 text-rose-800" : row.report_status === "credit" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700")}>{labels[row.report_status]}</span>;
}
function Balance({ row }: { row: Row }) {
  return <span className={cn("font-semibold", Number(row.owes_money) > 0 ? "text-rose-700" : Number(row.credit_amount) > 0 ? "text-emerald-700" : "text-slate-600")}>
    {Number(row.owes_money) > 0 ? `Owes ${money(Number(row.owes_money ?? 0))}` : Number(row.credit_amount) > 0 ? `Credit ${money(Number(row.credit_amount ?? 0))}` : money(0)}
  </span>;
}
function Details({ row }: { row: Row }) {
  const groups = [
    { title: "Sessions", items: [["Paid sessions", "total_paid_sessions"], ["Billable sessions", "total_played_sessions"], ["Remaining sessions", "remaining_sessions"]], currency: false },
    { title: "Waivers and refunds", items: [["Waived", "waived_amount"], ["Refunded", "refund_paid_amount"], ["Refund due", "refund_due_amount"]], currency: true },
    { title: "Credit and owing transfers", items: [["Credit transfer in", "transfer_in_amount"], ["Credit transfer out", "transfer_out_amount"], ["Owing transfer in", "debt_transfer_in_amount"], ["Owing transfer out", "debt_transfer_out_amount"]], currency: true }
  ];
  return <div className="grid gap-5 p-4 text-sm lg:grid-cols-3">{groups.map(group => <section key={group.title}>
    <h3 className="mb-2 font-semibold">{group.title}</h3>
    <dl className="space-y-2">{group.items.map(([label, key]) => <div className="flex justify-between gap-3" key={key}><dt className="text-slate-600">{label}</dt><dd>{group.currency ? money(Number(row[key] ?? 0)) : row[key] ?? 0}</dd></div>)}</dl>
  </section>)}</div>;
}
export function PaymentReportTable({ rows }: { rows: Row[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const prefix = useId();
  function toggle(key: string) { setExpanded(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; }); }
  if (!rows.length) return <p className="panel p-8 text-center text-slate-600">No payment records match these filters.</p>;
  return <>
    <div className="grid gap-3 md:hidden">{rows.map(row => {
      const key = `${row.player_id}:${row.season_id}`;
      return <article className="panel min-w-0 p-4" key={key}>
        <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="break-words font-semibold">{row.player_name}</h2><p className="text-xs text-slate-500">{row.season_name}</p></div><Status row={row} /></div>
        <dl className="my-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-slate-500">Paid</dt><dd>{money(Number(row.total_paid_amount ?? 0))}</dd></div><div><dt className="text-slate-500">Charged</dt><dd>{money(Number(row.estimated_used_amount ?? 0))}</dd></div><div className="col-span-2"><dt className="text-slate-500">Balance</dt><dd><Balance row={row} /></dd></div></dl>
        <details><summary className="cursor-pointer text-sm font-semibold text-pitch">View details<span className="sr-only"> for {row.player_name}, {row.season_name}</span></summary><Details row={row} /></details>
      </article>;
    })}</div>
    <div className="panel hidden md:block">
      <table className="w-full table-fixed text-left text-sm">
        <thead className="border-b border-line bg-slate-50 text-xs text-slate-600"><tr>{["Player", "Status", "Paid", "Charged", "Balance", "Details"].map(label => <th scope="col" className="p-3" key={label}>{label}</th>)}</tr></thead>
        <tbody>{rows.map(row => {
          const key = `${row.player_id}:${row.season_id}`;
          const open = expanded.has(key);
          const id = `${prefix}-${key}`;
          return <Fragment key={key}><tr className="border-b border-line [&>td]:break-words [&>td]:p-3 [&>td]:align-top">
            <td><span className="font-semibold">{row.player_name}</span><span className="mt-1 block text-xs text-slate-500">{row.season_name}</span></td><td><Status row={row} /></td><td>{money(Number(row.total_paid_amount ?? 0))}</td><td>{money(Number(row.estimated_used_amount ?? 0))}</td><td><Balance row={row} /></td>
            <td><button type="button" className="text-left font-semibold text-pitch" aria-expanded={open} aria-controls={id} onClick={() => toggle(key)}>{open ? "Hide details" : "View details"}<span className="sr-only"> for {row.player_name}, {row.season_name}</span></button></td>
          </tr><tr id={id} hidden={!open} className="border-b border-line bg-slate-50"><td colSpan={6}><Details row={row} /></td></tr></Fragment>;
        })}</tbody>
      </table>
    </div>
  </>;
}
