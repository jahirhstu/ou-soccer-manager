import Link from "next/link";
import { Plus } from "lucide-react";
import { AppShell } from "../(shell)";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { compareNumberAsc, compareText } from "@/lib/sorting";
import { money } from "@/lib/utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type SortKey = "created" | "name" | "status" | "start" | "planned" | "price";

export default async function SeasonsPage({
  searchParams
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const filters = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("seasons").select("*").order("created_at", { ascending: false });
  const rows = sortRows(data ?? [], sortKey(filters.sort));
  return (
    <AppShell>
      <Header title="Seasons" href="/seasons/new" label="New season" />
      <DataTable rows={rows} columns={[
        { header: "Name", cell: (row) => <Link className="font-medium text-pitch" href={`/seasons/${row.id}`}>{row.name}</Link> },
        { header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
        { header: "Dates", cell: (row) => `${row.start_date ?? "-"} to ${row.end_date ?? "-"}` },
        { header: "Planned", cell: (row) => row.total_planned_sessions ?? "-" },
        { header: "Price", cell: (row) => money(row.price_per_session) }
      ]} />
    </AppShell>
  );
}

function sortKey(value: string | undefined): SortKey {
  if (value === "name" || value === "status" || value === "start" || value === "planned" || value === "price") return value;
  return "created";
}

function sortRows(rows: any[], key: SortKey) {
  return [...rows].sort((left, right) => {
    if (key === "name") return compareText(left.name, right.name);
    if (key === "status") return compareText(left.status, right.status) || compareText(left.name, right.name);
    if (key === "start") return compareText(left.start_date, right.start_date) || compareText(left.name, right.name);
    if (key === "planned") return compareNumberAsc(left.total_planned_sessions, right.total_planned_sessions) || compareText(left.name, right.name);
    if (key === "price") return compareNumberAsc(left.price_per_session, right.price_per_session) || compareText(left.name, right.name);
    return compareText(right.created_at, left.created_at) || compareText(left.name, right.name);
  });
}

function Header({ title, href, label }: { title: string; href: string; label: string }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="page-title">{title}</h1>
      <Link className="btn-primary" href={href}><Plus className="h-4 w-4" /> {label}</Link>
    </div>
  );
}
