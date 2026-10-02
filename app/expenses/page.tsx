import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Save } from "lucide-react";
import { AppShell } from "../(shell)";
import { DataTable } from "@/components/DataTable";
import { hasPermission } from "@/lib/permissions";
import { compareNumberDesc, compareText } from "@/lib/sorting";
import { money } from "@/lib/utils";
import { createSupabaseServerClient, getCurrentProfile, getCurrentProgram } from "@/lib/supabase/server";
import { assignExpenseSeason } from "@/lib/actions/crud";

type ExpenseRow = {
  id: string;
  program_id: string | null;
  season_id: string | null;
  session_id: string | null;
  expense_date: string;
  category: string;
  amount: number | string | null;
  vendor: string | null;
  notes: string | null;
  programs?: { name?: string | null } | null;
  seasons?: { name?: string | null } | null;
  sessions?: { season_id?: string | null; session_date?: string | null; name?: string | null } | null;
};

type SortKey = "date_desc" | "date_asc" | "category" | "program" | "season" | "session" | "amount" | "vendor";

export default async function ExpensesPage({
  searchParams
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const filters = await searchParams;
  const profile = await getCurrentProfile();
  if (!hasPermission(profile?.role, "manage_finance")) redirect("/public/report");
  const supabase = await createSupabaseServerClient();
  const program = await getCurrentProgram();
  let query = supabase
    .from("club_expenses")
    .select("*,programs(name),seasons(name),sessions(season_id,session_date,name)")
    .order("expense_date", { ascending: false });
  if (program?.id) query = query.eq("program_id", program.id);
  const [{ data }, { data: seasons, error: seasonsError }] = await Promise.all([
    query,
    supabase.from("seasons").select("id,name,program_id").eq("organization_id", profile.organization_id).order("name")
  ]);
  if (seasonsError) throw new Error(seasonsError.message);
  const rows = sortRows((data ?? []) as ExpenseRow[], sortKey(filters.sort));
  const unassignedCount = rows.filter((row) => !row.season_id).length;
  const totalExpenses = rows.reduce((total, row) => total + Number(row.amount ?? 0), 0);

  return (
    <AppShell>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">{program?.name ? `${program.name} expenses` : "Expenses"}</h1>
          <p className="text-sm text-slate-500">Admin-only club spending for field rent, food, jerseys, and equipment.</p>
        </div>
        <Link className="btn-primary" href="/expenses/new"><Plus className="h-4 w-4" /> Record expense</Link>
      </div>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Total expenses" value={money(totalExpenses)} />
        <SummaryCard label="Expense records" value={rows.length} />
        <SummaryCard label="Categories" value={new Set(rows.map((row) => row.category)).size} />
      </div>
      {unassignedCount ? <p className="mb-4 text-sm text-amber-800" role="status">
        {unassignedCount} expense{unassignedCount === 1 ? "" : "s"} need a season before club balance can be carried forward.
      </p> : null}
      <DataTable rows={rows} columns={[
        { header: "Date", cell: (row) => row.expense_date },
        { header: "Category", cell: (row) => expenseCategoryLabel(row.category) },
        { header: "Program", cell: (row) => row.programs?.name ?? "-" },
        { header: "Amount", cell: (row) => money(Number(row.amount ?? 0)) },
        { header: "Vendor", cell: (row) => row.vendor ?? "-" },
        { header: "Season", cell: (row) => row.seasons?.name ?? (
          <form action={assignExpenseSeason} className="flex min-w-48 items-center gap-2">
            <input type="hidden" name="expense_id" value={row.id} />
            <select className="input min-w-32" name="season_id" aria-label={`Assign season for ${row.category} expense`} required defaultValue="">
              <option value="">Assign season</option>
              {(seasons ?? []).filter((season) => (!row.program_id || season.program_id === row.program_id)
                && (!row.session_id || season.id === row.sessions?.season_id))
                .map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}
            </select>
            <button className="btn-secondary" title="Save season assignment" aria-label="Save season assignment"><Save className="h-4 w-4" /></button>
          </form>
        ) },
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
  if (value === "date_asc" || value === "category" || value === "program" || value === "season" || value === "session" || value === "amount" || value === "vendor") return value;
  return "date_desc";
}

function sortRows(rows: ExpenseRow[], key: SortKey) {
  return [...rows].sort((left, right) => {
    if (key === "date_asc") return compareText(left.expense_date, right.expense_date) || compareText(left.vendor, right.vendor);
    if (key === "category") return compareText(left.category, right.category) || compareText(right.expense_date, left.expense_date);
    if (key === "program") return compareText(left.programs?.name, right.programs?.name) || compareText(right.expense_date, left.expense_date);
    if (key === "season") return compareText(left.seasons?.name, right.seasons?.name) || compareText(right.expense_date, left.expense_date);
    if (key === "session") return compareText(sessionLabel(left), sessionLabel(right)) || compareText(right.expense_date, left.expense_date);
    if (key === "amount") return compareNumberDesc(left.amount, right.amount) || compareText(right.expense_date, left.expense_date);
    if (key === "vendor") return compareText(left.vendor, right.vendor) || compareText(right.expense_date, left.expense_date);
    return compareText(right.expense_date, left.expense_date) || compareText(left.vendor, right.vendor);
  });
}
