import Link from "next/link";
import { Plus } from "lucide-react";
import { AppShell } from "../(shell)";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { compareText } from "@/lib/sorting";
import { createSupabaseServerClient, getCurrentProgram } from "@/lib/supabase/server";

type SortKey = "name" | "status" | "position" | "email";

export default async function PlayersPage({
  searchParams
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const filters = await searchParams;
  const supabase = await createSupabaseServerClient();
  const program = await getCurrentProgram();
  const { data: memberships } = program?.id
    ? await supabase.from("program_members").select("player_id").eq("program_id", program.id).eq("status", "active").not("player_id", "is", null)
    : { data: [] };
  const playerIds = (memberships ?? []).map((membership) => membership.player_id).filter(Boolean) as string[];
  const { data } = playerIds.length
    ? await supabase.from("players").select("*").in("id", playerIds).order("display_name")
    : { data: [] };
  const rows = sortRows(data ?? [], sortKey(filters.sort));
  return (
    <AppShell>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Players</h1>
        <Link className="btn-primary" href="/players/new"><Plus className="h-4 w-4" /> New player</Link>
      </div>
      <DataTable rows={rows} columns={[
        { header: "Name", cell: (row) => <Link className="font-medium text-pitch" href={`/players/${row.id}`}>{row.display_name}</Link> },
        { header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
        { header: "Phone", cell: (row) => row.phone ?? "-" },
        { header: "Email", cell: (row) => row.email ?? "-" },
        { header: "Position", cell: (row) => row.preferred_position ?? "-" }
      ]} />
    </AppShell>
  );
}

function sortKey(value: string | undefined): SortKey {
  if (value === "status" || value === "position" || value === "email") return value;
  return "name";
}

function sortRows(rows: any[], key: SortKey) {
  return [...rows].sort((left, right) => {
    if (key === "status") return compareText(left.status, right.status) || compareText(left.display_name, right.display_name);
    if (key === "position") return compareText(left.preferred_position, right.preferred_position) || compareText(left.display_name, right.display_name);
    if (key === "email") return compareText(left.email, right.email) || compareText(left.display_name, right.display_name);
    return compareText(left.display_name, right.display_name);
  });
}
