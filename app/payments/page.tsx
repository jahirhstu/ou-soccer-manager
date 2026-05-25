import Link from "next/link";
import { Plus } from "lucide-react";
import { AppShell } from "../(shell)";
import { DataTable } from "@/components/DataTable";
import { compareNumberDesc, compareText } from "@/lib/sorting";
import { money } from "@/lib/utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type SortKey = "date_desc" | "date_asc" | "player" | "season" | "amount" | "sessions" | "method";

export default async function PaymentsPage({
  searchParams
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const filters = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("payments").select("*,players(display_name),seasons(name)").gt("amount", 0).order("payment_date", { ascending: false });
  const rows = sortRows(data ?? [], sortKey(filters.sort));
  return (
    <AppShell>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Payments</h1>
        <Link className="btn-primary" href="/payments/new"><Plus className="h-4 w-4" /> Record payment</Link>
      </div>
      <DataTable rows={rows} columns={[
        { header: "Player", cell: (row: any) => row.players?.display_name ?? "-" },
        { header: "Season", cell: (row: any) => row.seasons?.name ?? "-" },
        { header: "Date", cell: (row) => row.payment_date },
        { header: "Amount", cell: (row) => money(row.amount) },
        { header: "Paid sessions", cell: (row) => row.sessions_covered ?? "-" },
        { header: "Method", cell: (row) => row.payment_method ?? "-" }
      ]} />
    </AppShell>
  );
}

function sortKey(value: string | undefined): SortKey {
  if (value === "date_asc" || value === "player" || value === "season" || value === "amount" || value === "sessions" || value === "method") return value;
  return "date_desc";
}

function sortRows(rows: any[], key: SortKey) {
  return [...rows].sort((left, right) => {
    if (key === "date_asc") return compareText(left.payment_date, right.payment_date) || compareText(left.players?.display_name, right.players?.display_name);
    if (key === "player") return compareText(left.players?.display_name, right.players?.display_name) || compareText(right.payment_date, left.payment_date);
    if (key === "season") return compareText(left.seasons?.name, right.seasons?.name) || compareText(left.players?.display_name, right.players?.display_name);
    if (key === "amount") return compareNumberDesc(left.amount, right.amount) || compareText(left.players?.display_name, right.players?.display_name);
    if (key === "sessions") return compareNumberDesc(left.sessions_covered, right.sessions_covered) || compareText(left.players?.display_name, right.players?.display_name);
    if (key === "method") return compareText(left.payment_method, right.payment_method) || compareText(right.payment_date, left.payment_date);
    return compareText(right.payment_date, left.payment_date) || compareText(left.players?.display_name, right.players?.display_name);
  });
}
