import { PaymentReportTable } from "@/components/PaymentReportTable";
import Link from "next/link";
import { compareNumberDesc, compareText } from "@/lib/sorting";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "../../(shell)";
import { Download } from "lucide-react";

type SortKey = "player" | "season" | "status" | "paid" | "used" | "balance";
type Filters = { player?: string; sessionId?: string; status?: string; season?: string; sort?: string; page?: string; pageSize?: string };

export default async function PaymentReportPage({
  searchParams
}: {
  searchParams: Promise<Filters>;
}) {
  const filters = await searchParams;
  const supabase = await createSupabaseServerClient();
  const results = await Promise.all([
    supabase.from("player_season_payment_summary").select("*"),
    supabase.from("sessions").select("id,name,session_date,location,playgrounds(name)").order("session_date", { ascending: false }),
    filters.sessionId
      ? supabase.from("attendance").select("player_id").eq("session_id", filters.sessionId)
      : Promise.resolve({ data: null }),
    supabase.from("player_season_transfer_summary").select("player_id,season_id,transfer_in_amount,transfer_out_amount,debt_transfer_in_amount,debt_transfer_out_amount")
  ]);
  for (const result of results) if ("error" in result && result.error) throw new Error(result.error.message);
  const [{ data }, { data: sessions }, { data: sessionAttendance }, { data: transfers }] = results;
  const seasons = [...new Map((data ?? []).map(row => [row.season_id, row.season_name])).entries()];
  const transferByPlayerSeason = new Map((transfers ?? []).map((row) => [`${row.player_id}:${row.season_id}`, row]));
  const attendedPlayerIds = new Set((sessionAttendance ?? []).map((row) => row.player_id));
  const rowsWithTransfers = (data ?? []).map((row) => ({ ...row,
    transfer_in_amount: transferByPlayerSeason.get(`${row.player_id}:${row.season_id}`)?.transfer_in_amount ?? 0,
    transfer_out_amount: transferByPlayerSeason.get(`${row.player_id}:${row.season_id}`)?.transfer_out_amount ?? 0,
    debt_transfer_in_amount: transferByPlayerSeason.get(`${row.player_id}:${row.season_id}`)?.debt_transfer_in_amount ?? 0,
    debt_transfer_out_amount: transferByPlayerSeason.get(`${row.player_id}:${row.season_id}`)?.debt_transfer_out_amount ?? 0
  }));
  const filteredRows = sortRows(rowsWithTransfers.filter((row) => {
    if (filters.season && row.season_id !== filters.season) return false;
    if (filters.player && !String(row.player_name ?? "").toLowerCase().includes(filters.player.toLowerCase())) return false;
    if (filters.sessionId && !attendedPlayerIds.has(row.player_id)) return false;
    if (filters.status && filters.status !== "all" && paymentStatus(row) !== filters.status) return false;
    return true;
  }), sortKey(filters.sort));
  const pageSize = [10, 25, 50].includes(Number(filters.pageSize)) ? Number(filters.pageSize) : 25;
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const requestedPage = Number(filters.page);
  const page = Math.min(totalPages, Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1);
  const pageRows = filteredRows.slice((page - 1) * pageSize, page * pageSize).map(row => ({ ...row, report_status: paymentStatus(row) }));
  const pageHref = (target: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value && key !== "page") params.set(key, value);
    params.set("page", String(target));
    return `/reports/payments?${params}`;
  };
  const csv = [
    "Player,Season,Amount paid,Paid sessions,Billable sessions,Remaining sessions,Used,Waived,Refunded,Credit transfer in,Credit transfer out,Owing transfer in,Owing transfer out,Credit,Refund due,Owes",
    ...filteredRows.map((row) =>
      [
        row.player_name,
        row.season_name,
        row.total_paid_amount,
        row.total_paid_sessions,
        row.total_played_sessions,
        row.remaining_sessions,
        row.estimated_used_amount,
        row.waived_amount,
        row.refund_paid_amount,
        row.transfer_in_amount,
        row.transfer_out_amount,
        row.debt_transfer_in_amount,
        row.debt_transfer_out_amount,
        row.credit_amount,
        row.refund_due_amount,
        row.owes_money
      ].map(csvCell).join(",")
    )
  ].join("\n");
  return (
    <AppShell>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Payment report</h1>
        <div className="flex flex-wrap gap-2">
          <a className="btn-secondary" download="payment-report.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`}>
            <Download className="h-4 w-4" />
            Export filtered CSV
          </a>
        </div>
      </div>
      <p className="mb-4 text-sm text-slate-600">Each record shows one player’s totals for one season. Charged includes posted upcoming session fees. Open details for sessions, waivers, refunds, and transfers.</p>
      <form className="panel mb-5 grid grid-cols-1 items-end gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto]">
        <label className="flex min-w-0 flex-col gap-1 text-sm">Season<select className="input block w-full min-w-0 max-w-full truncate" defaultValue={filters.season ?? ""} name="season">
          <option value="">All seasons</option>
          {seasons.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select></label>
        <label className="flex min-w-0 flex-col gap-1 text-sm">Player<input className="input block w-full min-w-0 max-w-full truncate" defaultValue={filters.player ?? ""} name="player" placeholder="Search player" /></label>
        <label className="flex min-w-0 flex-col gap-1 text-sm">Session<select className="input block w-full min-w-0 max-w-full truncate" defaultValue={filters.sessionId ?? ""} name="sessionId">
          <option value="">All sessions</option>
          {(sessions ?? []).map((session) => {
            const playgroundName = (session as any).playgrounds?.name ?? session.location;
            return (
              <option key={session.id} value={session.id}>
                {session.session_date} {session.name ? `- ${session.name}` : ""} {playgroundName ? `- ${playgroundName}` : ""}
              </option>
            );
          })}
        </select></label>
        <label className="flex min-w-0 flex-col gap-1 text-sm">Status<select className="input block w-full min-w-0 max-w-full truncate" defaultValue={filters.status ?? "all"} name="status">
          <option value="all">All statuses</option>
          <option value="owes">Owes</option>
          <option value="credit">Has credit</option>
          <option value="settled">Settled</option>
          <option value="no_payment">No payment</option>
        </select></label>
        <label className="flex min-w-0 flex-col gap-1 text-sm">Sort by<select className="input block w-full min-w-0 max-w-full truncate" name="sort" defaultValue={sortKey(filters.sort)}>
          <option value="player">Player A–Z</option><option value="season">Season A–Z</option>
          <option value="status">Status A–Z</option><option value="paid">Paid: highest first</option>
          <option value="used">Charged: highest first</option><option value="balance">Balance: credit to owing</option>
        </select></label>
        <label className="flex min-w-0 flex-col gap-1 text-sm">Records per page<select className="input block w-full min-w-0 max-w-full truncate" name="pageSize" defaultValue={pageSize}>
          {[10, 25, 50].map(size => <option key={size} value={size}>{size}</option>)}
        </select></label>
        <button type="submit" className="btn-primary h-10 w-auto self-end justify-self-start whitespace-nowrap">Apply</button>
      </form>
      <PaymentReportTable rows={pageRows} />
      <nav aria-label="Payment report pages" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
        <p>Showing {filteredRows.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filteredRows.length)} of {filteredRows.length} records</p>
        <div className="flex items-center gap-3">
          {page > 1 ? <Link className="btn-secondary" href={pageHref(page - 1)}>Previous</Link> : <span aria-disabled="true" className="text-slate-400">Previous</span>}
          <span>Page {page} of {totalPages}</span>
          {page < totalPages ? <Link className="btn-secondary" href={pageHref(page + 1)}>Next</Link> : <span aria-disabled="true" className="text-slate-400">Next</span>}
        </div>
      </nav>
    </AppShell>
  );
}

function paymentStatus(row: any) {
  if (Number(row.owes_money ?? 0) > 0) return "owes";
  if (Number(row.credit_amount ?? 0) > 0) return "credit";
  if ([row.transfer_in_amount, row.transfer_out_amount, row.debt_transfer_in_amount, row.debt_transfer_out_amount].some((amount) => Number(amount ?? 0) > 0)) return "settled";
  if (Number(row.total_paid_amount ?? 0) === 0) return "no_payment";
  return "settled";
}

function paymentStatusLabel(status: string) {
  if (status === "owes") return "Owes";
  if (status === "credit") return "Has credit";
  if (status === "no_payment") return "No payment";
  return "Settled";
}

function sortKey(value: string | undefined): SortKey {
  return value === "season" || value === "status" || value === "paid" || value === "used" || value === "balance" ? value : "player";
}

function sortRows(rows: any[], key: SortKey) {
  return [...rows].sort((left, right) => {
    let comparison = 0;
    if (key === "season") comparison = compareText(left.season_name, right.season_name);
    if (key === "status") comparison = compareText(paymentStatusLabel(paymentStatus(left)), paymentStatusLabel(paymentStatus(right)));
    if (key === "paid") comparison = compareNumberDesc(left.total_paid_amount, right.total_paid_amount);
    if (key === "used") comparison = compareNumberDesc(left.estimated_used_amount, right.estimated_used_amount);
    if (key === "balance") comparison = compareNumberDesc(Number(left.credit_amount ?? 0) - Number(left.owes_money ?? 0), Number(right.credit_amount ?? 0) - Number(right.owes_money ?? 0));
    return comparison || compareText(left.player_name, right.player_name) || compareText(left.season_name, right.season_name)
      || compareText(left.player_id, right.player_id) || compareText(left.season_id, right.season_id);
  });
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '\"\"')}"` : text;
}
