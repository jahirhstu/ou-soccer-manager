import Link from "next/link";
import { Plus } from "lucide-react";
import { AppShell } from "../(shell)";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";

export default async function LeaguesPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: leagues }, profile] = await Promise.all([
    supabase.from("leagues").select("*,league_teams(id),league_matches(id)").order("created_at", { ascending: false }),
    getCurrentProfile()
  ]);
  const canManage = hasPermission(profile?.role, "manage_all");

  return (
    <AppShell>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Leagues</h1>
        {canManage ? <Link className="btn-primary" href="/leagues/new"><Plus className="h-4 w-4" /> New league</Link> : null}
      </div>
      <DataTable rows={leagues ?? []} columns={[
        { header: "League", cell: (row) => <Link className="font-medium text-pitch" href={`/leagues/${row.id}`}>{row.name}</Link> },
        { header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
        { header: "Dates", cell: (row) => `${row.start_date ?? "-"} to ${row.end_date ?? "-"}` },
        { header: "Teams", cell: (row: any) => row.league_teams?.length ?? 0 },
        { header: "Fixtures", cell: (row: any) => row.league_matches?.length ?? 0 }
      ]} />
    </AppShell>
  );
}
