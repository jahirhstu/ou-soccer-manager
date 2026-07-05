import Link from "next/link";
import { BadgeDollarSign, MessageSquareText, Plus } from "lucide-react";
import { AppShell } from "../(shell)";
import { DataTable } from "@/components/DataTable";
import { PaymentFlashToast } from "@/components/PaymentFlashToast";
import { compareNumberDesc, compareText } from "@/lib/sorting";
import { money } from "@/lib/utils";
import { createSupabaseServerClient, getCurrentProgram } from "@/lib/supabase/server";

type SortKey = "date_desc" | "date_asc" | "player" | "program" | "season" | "session" | "amount" | "sessions" | "method";
type PaymentHistoryRow = {
  playerName: string;
  programName: string;
  seasonName: string;
  sessionLabel: string;
  date: string;
  amount: number;
  sessionsCovered: number | string | null;
  method: string;
  kind: "Payment" | "Waiver";
  note?: string | null;
};

export default async function PaymentsPage({
  searchParams
}: {
  searchParams: Promise<{ sort?: string; success?: string }>;
}) {
  const filters = await searchParams;
  const supabase = await createSupabaseServerClient();
  const program = await getCurrentProgram();
  let query = supabase.from("payments").select("*,players(display_name),programs(name),seasons(name),sessions(session_date,name)").gt("amount", 0).order("payment_date", { ascending: false });
  let waiverQuery = supabase
    .from("session_player_charges")
    .select("*,players(display_name),programs(name),seasons(name),sessions(session_date,name)")
    .gt("waiver_amount", 0)
    .order("waived_at", { ascending: false });
  if (program?.id) query = query.eq("program_id", program.id);
  if (program?.id) waiverQuery = waiverQuery.eq("program_id", program.id);
  const [{ data }, { data: waivers }] = await Promise.all([query, waiverQuery]);
  const rows = sortRows([...paymentRows(data ?? []), ...waiverRows(waivers ?? [])], sortKey(filters.sort));
  return (
    <AppShell>
      <PaymentFlashToast success={filters.success} />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">{program?.name ? `${program.name} payments` : "Payments"}</h1>
        <div className="flex flex-wrap gap-2">
          <Link className="btn-secondary" href="/payments/reminders"><MessageSquareText className="h-4 w-4" /> WhatsApp reminders</Link>
          <Link className="btn-secondary" href="/payments/waiver"><BadgeDollarSign className="h-4 w-4" /> Record waiver</Link>
          <Link className="btn-primary" href="/payments/new"><Plus className="h-4 w-4" /> Record payment</Link>
        </div>
      </div>
      <DataTable rows={rows} columns={[
        { header: "Type", cell: (row) => row.kind },
        { header: "Player", cell: (row) => row.playerName },
        { header: "Program", cell: (row) => row.programName },
        { header: "Season", cell: (row) => row.seasonName },
        { header: "Session", cell: (row) => row.sessionLabel },
        { header: "Date", cell: (row) => row.date },
        { header: "Amount", cell: (row) => row.kind === "Waiver" ? `${money(row.amount)} waived` : money(row.amount) },
        { header: "Paid sessions", cell: (row) => row.sessionsCovered ?? "-" },
        { header: "Method", cell: (row) => row.method },
        { header: "Note", cell: (row) => row.note ?? "-" }
      ]} />
    </AppShell>
  );
}

function sortKey(value: string | undefined): SortKey {
  if (value === "date_asc" || value === "player" || value === "program" || value === "season" || value === "session" || value === "amount" || value === "sessions" || value === "method") return value;
  return "date_desc";
}

function sortRows(rows: PaymentHistoryRow[], key: SortKey) {
  return [...rows].sort((left, right) => {
    if (key === "date_asc") return compareText(left.date, right.date) || compareText(left.playerName, right.playerName);
    if (key === "player") return compareText(left.playerName, right.playerName) || compareText(right.date, left.date);
    if (key === "program") return compareText(left.programName, right.programName) || compareText(right.date, left.date);
    if (key === "season") return compareText(left.seasonName, right.seasonName) || compareText(left.playerName, right.playerName);
    if (key === "session") return compareText(left.sessionLabel, right.sessionLabel) || compareText(right.date, left.date);
    if (key === "amount") return compareNumberDesc(left.amount, right.amount) || compareText(left.playerName, right.playerName);
    if (key === "sessions") return compareNumberDesc(left.sessionsCovered, right.sessionsCovered) || compareText(left.playerName, right.playerName);
    if (key === "method") return compareText(left.method, right.method) || compareText(right.date, left.date);
    return compareText(right.date, left.date) || compareText(left.playerName, right.playerName);
  });
}

function paymentRows(rows: any[]): PaymentHistoryRow[] {
  return rows.map((row) => ({
    playerName: row.players?.display_name ?? "-",
    programName: row.programs?.name ?? "-",
    seasonName: row.seasons?.name ?? "-",
    sessionLabel: sessionLabel(row, "Season payment", "Session payment"),
    date: row.payment_date,
    amount: Number(row.amount ?? 0),
    sessionsCovered: row.sessions_covered ?? "-",
    method: row.payment_method ?? "-",
    kind: "Payment",
    note: row.reference_note
  }));
}

function waiverRows(rows: any[]): PaymentHistoryRow[] {
  return rows.map((row) => ({
    playerName: row.players?.display_name ?? "-",
    programName: row.programs?.name ?? "-",
    seasonName: row.seasons?.name ?? "-",
    sessionLabel: sessionLabel(row, "Session waiver", "Session waiver"),
    date: String(row.waived_at ?? row.created_at ?? ""),
    amount: Number(row.waiver_amount ?? 0),
    sessionsCovered: "-",
    method: "Waiver",
    kind: "Waiver",
    note: row.waiver_reason
  }));
}

function sessionLabel(row: any, seasonFallback: string, sessionFallback: string) {
  if (!row.sessions) return seasonFallback;
  return [row.sessions.session_date, row.sessions.name].filter(Boolean).join(" - ") || sessionFallback;
}
