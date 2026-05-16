import Link from "next/link";
import { Plus } from "lucide-react";
import { AppShell } from "../(shell)";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { money } from "@/lib/utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function SeasonsPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("seasons").select("*").order("created_at", { ascending: false });
  return (
    <AppShell>
      <Header title="Seasons" href="/seasons/new" label="New season" />
      <DataTable rows={data ?? []} columns={[
        { header: "Name", cell: (row) => <Link className="font-medium text-pitch" href={`/seasons/${row.id}`}>{row.name}</Link> },
        { header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
        { header: "Dates", cell: (row) => `${row.start_date ?? "-"} to ${row.end_date ?? "-"}` },
        { header: "Planned", cell: (row) => row.total_planned_sessions ?? "-" },
        { header: "Price", cell: (row) => money(row.price_per_session) }
      ]} />
    </AppShell>
  );
}

function Header({ title, href, label }: { title: string; href: string; label: string }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="page-title">{title}</h1>
      <Link className="btn-primary" href={href}><Plus className="h-4 w-4" /> {label}</Link>
    </div>
  );
}
