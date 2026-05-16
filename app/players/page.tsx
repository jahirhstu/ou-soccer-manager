import Link from "next/link";
import { Plus } from "lucide-react";
import { AppShell } from "../(shell)";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function PlayersPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("players").select("*").order("display_name");
  return (
    <AppShell>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Players</h1>
        <Link className="btn-primary" href="/players/new"><Plus className="h-4 w-4" /> New player</Link>
      </div>
      <DataTable rows={data ?? []} columns={[
        { header: "Name", cell: (row) => <Link className="font-medium text-pitch" href={`/players/${row.id}`}>{row.display_name}</Link> },
        { header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
        { header: "Phone", cell: (row) => row.phone ?? "-" },
        { header: "Email", cell: (row) => row.email ?? "-" },
        { header: "Position", cell: (row) => row.preferred_position ?? "-" }
      ]} />
    </AppShell>
  );
}
