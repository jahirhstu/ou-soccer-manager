import { DataTable } from "@/components/DataTable";
import { cn, money } from "@/lib/utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "../../(shell)";
import { Download } from "lucide-react";
import Link from "next/link";

export default async function PaymentReportPage({
  searchParams
}: {
  searchParams: Promise<{ player?: string; sessionId?: string; status?: string }>;
}) {
  const filters = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [{ data }, { data: sessions }, { data: sessionAttendance }] = await Promise.all([
    supabase.from("player_season_payment_summary").select("*"),
    supabase.from("sessions").select("id,name,session_date,location,playgrounds(name)").order("session_date", { ascending: false }),
    filters.sessionId
      ? supabase.from("attendance").select("player_id").eq("session_id", filters.sessionId)
      : Promise.resolve({ data: null })
  ]);
  const attendedPlayerIds = new Set((sessionAttendance ?? []).map((row) => row.player_id));
  const filteredRows = (data ?? []).filter((row) => {
    if (filters.player && !String(row.player_name ?? "").toLowerCase().includes(filters.player.toLowerCase())) return false;
    if (filters.sessionId && !attendedPlayerIds.has(row.player_id)) return false;
    if (filters.status && filters.status !== "all" && paymentStatus(row) !== filters.status) return false;
    return true;
  });
  const csv = [
    "Player,Season,Amount paid,Paid sessions,Played sessions,Remaining sessions,Used,Credit,Refund due,Owes",
    ...filteredRows.map((row) =>
      [
        row.player_name,
        row.season_name,
        row.total_paid_amount,
        row.total_paid_sessions,
        row.total_played_sessions,
        row.remaining_sessions,
        row.estimated_used_amount,
        row.credit_amount,
        row.refund_due_amount,
        row.owes_money
      ].join(",")
    )
  ].join("\n");
  return (
    <AppShell>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Payment report</h1>
        <div className="flex flex-wrap gap-2">
          <Link className="btn-secondary" href="/public/report">Public report</Link>
          <a className="btn-secondary" download="payment-report.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`}>
            <Download className="h-4 w-4" />
            Export CSV
          </a>
        </div>
      </div>
      <form className="panel mb-5 grid gap-3 p-4 md:grid-cols-[1fr_1fr_180px_auto]">
        <input className="input" defaultValue={filters.player ?? ""} name="player" placeholder="Filter by player" />
        <select className="input" defaultValue={filters.sessionId ?? ""} name="sessionId">
          <option value="">All sessions</option>
          {(sessions ?? []).map((session) => {
            const playgroundName = (session as any).playgrounds?.name ?? session.location;
            return (
              <option key={session.id} value={session.id}>
                {session.session_date} {session.name ? `- ${session.name}` : ""} {playgroundName ? `- ${playgroundName}` : ""}
              </option>
            );
          })}
        </select>
        <select className="input" defaultValue={filters.status ?? "all"} name="status">
          <option value="all">All statuses</option>
          <option value="owes">Owes</option>
          <option value="credit">Has credit</option>
          <option value="settled">Settled</option>
          <option value="no_payment">No payment</option>
        </select>
        <button className="btn-primary justify-center">Apply</button>
      </form>
      <DataTable rows={filteredRows} columns={[
        { header: "Player", cell: (row) => row.player_name ?? "-" },
        { header: "Season", cell: (row) => row.season_name ?? "-" },
        { header: "Status", cell: (row) => <BalanceBadge status={paymentStatus(row)} /> },
        { header: "Amount paid", cell: (row) => money(row.total_paid_amount) },
        { header: "Paid sessions", cell: (row) => row.total_paid_sessions ?? 0 },
        { header: "Played sessions", cell: (row) => row.total_played_sessions ?? 0 },
        { header: "Remaining sessions", cell: (row) => row.remaining_sessions ?? 0 },
        { header: "Used", cell: (row) => money(row.estimated_used_amount) },
        { header: "Credit", cell: (row) => <MoneyPill amount={row.credit_amount} tone={Number(row.credit_amount ?? 0) > 0 ? "credit" : "neutral"} /> },
        { header: "Refund due", cell: (row) => money(row.refund_due_amount) },
        { header: "Owes", cell: (row) => <MoneyPill amount={row.owes_money} tone={Number(row.owes_money ?? 0) > 0 ? "owes" : "neutral"} /> }
      ]} />
    </AppShell>
  );
}

function paymentStatus(row: any) {
  if (Number(row.owes_money ?? 0) > 0) return "owes";
  if (Number(row.credit_amount ?? 0) > 0) return "credit";
  if (Number(row.total_paid_amount ?? 0) === 0) return "no_payment";
  return "settled";
}

function paymentStatusLabel(status: string) {
  if (status === "owes") return "Owes";
  if (status === "credit") return "Has credit";
  if (status === "no_payment") return "No payment";
  return "Settled";
}

function BalanceBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-md px-2.5 py-1 text-xs font-semibold",
        status === "owes" && "bg-rose-100 text-rose-800",
        status === "credit" && "bg-emerald-100 text-emerald-800",
        status === "settled" && "bg-slate-100 text-slate-700",
        status === "no_payment" && "bg-amber-100 text-amber-800"
      )}
    >
      {paymentStatusLabel(status)}
    </span>
  );
}

function MoneyPill({ amount, tone }: { amount: number | string | null | undefined; tone: "credit" | "owes" | "neutral" }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-md px-2.5 py-1 text-xs font-semibold",
        tone === "credit" && "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
        tone === "owes" && "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
        tone === "neutral" && "bg-slate-50 text-slate-600 ring-1 ring-slate-200"
      )}
    >
      {money(Number(amount ?? 0))}
    </span>
  );
}
