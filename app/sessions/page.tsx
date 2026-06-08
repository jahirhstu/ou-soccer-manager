import Link from "next/link";
import { Plus } from "lucide-react";
import { AppShell } from "../(shell)";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { hasPermission } from "@/lib/permissions";
import { compareNumberAsc, compareText } from "@/lib/sorting";
import { money } from "@/lib/utils";
import { createSupabaseServerClient, getCurrentProfile, getCurrentProgram } from "@/lib/supabase/server";

type SortKey = "date_desc" | "date_asc" | "name" | "program" | "season" | "field" | "status" | "price";

export default async function SessionsPage({
  searchParams
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const filters = await searchParams;
  const supabase = await createSupabaseServerClient();
  const program = await getCurrentProgram();
  let sessionsQuery = supabase.from("sessions").select("*,programs(name),seasons(name),playgrounds(name)").order("session_date", { ascending: false });
  if (program?.id) sessionsQuery = sessionsQuery.eq("program_id", program.id);
  const [{ data }, profile] = await Promise.all([
    sessionsQuery,
    getCurrentProfile()
  ]);
  const isAdmin = hasPermission(profile?.role, "manage_all");
  const rows = sortRows(data ?? [], sortKey(filters.sort));
  return (
    <AppShell>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">{program?.name ? `${program.name} sessions` : "Sessions"}</h1>
        {isAdmin ? <Link className="btn-primary" href="/sessions/new"><Plus className="h-4 w-4" /> New session</Link> : null}
      </div>
      <DataTable rows={rows} columns={[
        { header: "Date", cell: (row) => <Link className="font-medium text-pitch" href={`/sessions/${row.id}`}>{row.session_date}</Link> },
        { header: "Name", cell: (row) => row.name ?? "-" },
        { header: "Program", cell: (row: any) => row.programs?.name ?? "-" },
        { header: "Season", cell: (row: any) => row.seasons?.name ?? "-" },
        { header: "Playground", cell: (row: any) => row.playgrounds?.name ?? row.location ?? "-" },
        { header: "Price", cell: (row) => row.price_per_session == null ? "Season default" : money(row.price_per_session) },
        { header: "Status", cell: (row) => <StatusBadge status={row.status} /> }
      ]} />
    </AppShell>
  );
}

function sortKey(value: string | undefined): SortKey {
  if (value === "date_asc" || value === "name" || value === "program" || value === "season" || value === "field" || value === "status" || value === "price") return value;
  return "date_desc";
}

function sortRows(rows: any[], key: SortKey) {
  return [...rows].sort((left, right) => {
    if (key === "date_asc") return compareText(left.session_date, right.session_date) || compareText(left.name, right.name);
    if (key === "name") return compareText(left.name, right.name) || compareText(right.session_date, left.session_date);
    if (key === "program") return compareText(left.programs?.name, right.programs?.name) || compareText(right.session_date, left.session_date);
    if (key === "season") return compareText(left.seasons?.name, right.seasons?.name) || compareText(right.session_date, left.session_date);
    if (key === "field") return compareText(left.playgrounds?.name ?? left.location, right.playgrounds?.name ?? right.location) || compareText(right.session_date, left.session_date);
    if (key === "status") return compareText(left.status, right.status) || compareText(right.session_date, left.session_date);
    if (key === "price") return compareNumberAsc(left.price_per_session, right.price_per_session) || compareText(right.session_date, left.session_date);
    return compareText(right.session_date, left.session_date) || compareText(left.name, right.name);
  });
}
