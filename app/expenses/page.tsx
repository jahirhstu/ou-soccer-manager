import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { AppShell } from "../(shell)";
import { DataTable } from "@/components/DataTable";
import { hasPermission } from "@/lib/permissions";
import { compareNumberDesc, compareText } from "@/lib/sorting";
import { money } from "@/lib/utils";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";

type ExpenseRow = {
  id: string;
  expense_date: string;
  category: string;
  amount: number | string | null;
  vendor: string | null;
  notes: string | null;
  seasons?: { name?: string | null } | null;
  sessions?: { session_date?: string | null; name?: string | null } | null;
};

type SortKey = "date_desc" | "date_asc" | "category" | "season" | "session" | "amount" | "vendor";

export default async function ExpensesPage({
  searchParams
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const filters = await searchParams;
  const profile = await getCurrentProfile();
  if (!hasPermission(profile?.role, "manage_finance")) redirect("/public/report");
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("club_expenses")
    .select("*,seasons(name),sessions(session_date,name)")
    .order("expense_date", { ascending: false });
  const rows = sortRows((data ?? []) as ExpenseRow[], sortKey(filters.sort));
  const totalExpenses = rows.reduce((total, row) => total + Number(row.amount ?? 0), 0);

  return (
    <AppShell>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Expenses</h1>
          <p className="text-sm text-slate-500">Admin-only club spending for field rent, food, jerseys, and equipment.</p>
        </div>
        <Link className="btn-primary" href="/expenses/new"><Plus className="h-4 w-4" /> Record expense</Link>
      </div>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Total expenses" value={money(totalExpenses)} />
        <SummaryCard label="Expense records" value={rows.length} />
        <SummaryCard label="Categories" value={new Set(rows.map((row) => row.category)).size} />
      </div>
      <DataTable rows={rows} columns={[
        { header: "Date", cell: (row) => row.expense_date },
        { header: "Category", cell: (row) => expenseCategoryLabel(row.category) },
        { header: "Amount", cell: (row) => money(Number(row.amount ?? 0)) },
        { header: "Vendor", cell: (row) => row.vendor ?? "-" },
        { header: "Season", cell: (row) => row.seasons?.name ?? "-" },
        { header: "Session", cell: (row) => sessionLabel(row) },
        { header: "Note", cell: (row) => row.notes ?? "-" }
      ]} />
    </AppShell>
  );
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="panel p-4">
      <div className="text-sm font-medium text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-ink">{value}</div>
    </div>
  );
}

function expenseCategoryLabel(value: string) {
  const labels: Record<string, string> = {
    dome_rent: "Dome rent",
    equipment: "Equipment",
    food: "Food",
    jersey: "Jersey",
    other: "Other"
  };
  return labels[value] ?? value;
}

function sessionLabel(row: ExpenseRow) {
  if (!row.sessions) return "-";
  return [row.sessions.session_date, row.sessions.name].filter(Boolean).join(" - ") || "-";
}

function sortKey(value: string | undefined): SortKey {
  if (value === "date_asc" || value === "category" || value === "season" || value === "session" || value === "amount" || value === "vendor") return value;
  return "date_desc";
}

function sortRows(rows: ExpenseRow[], key: SortKey) {
  return [...rows].sort((left, right) => {
    if (key === "date_asc") return compareText(left.expense_date, right.expense_date) || compareText(left.vendor, right.vendor);
    if (key === "category") return compareText(left.category, right.category) || compareText(right.expense_date, left.expense_date);
    if (key === "season") return compareText(left.seasons?.name, right.seasons?.name) || compareText(right.expense_date, left.expense_date);
    if (key === "session") return compareText(sessionLabel(left), sessionLabel(right)) || compareText(right.expense_date, left.expense_date);
    if (key === "amount") return compareNumberDesc(left.amount, right.amount) || compareText(right.expense_date, left.expense_date);
    if (key === "vendor") return compareText(left.vendor, right.vendor) || compareText(right.expense_date, left.expense_date);
    return compareText(right.expense_date, left.expense_date) || compareText(left.vendor, right.vendor);
  });
}
