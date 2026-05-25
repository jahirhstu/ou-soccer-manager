import { DataTable } from "@/components/DataTable";
import { compareNumberDesc, compareText } from "@/lib/sorting";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "../../(shell)";
import Link from "next/link";

type SortKey = "goals" | "player" | "season" | "assists" | "appearances";

export default async function StatsReportPage({
  searchParams
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const filters = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("player_season_stats_summary").select("*").order("goals", { ascending: false });
  const rows = sortRows(data ?? [], sortKey(filters.sort));
  return (
    <AppShell>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Stats report</h1>
        <Link className="btn-secondary" href="/reports/playground-stats">Playground stats</Link>
      </div>
      <DataTable rows={rows} columns={[
        { header: "Player", cell: (row) => row.player_name ?? "-" },
        { header: "Season", cell: (row) => row.season_name ?? "-" },
        { header: "Goals", cell: (row) => row.goals ?? 0 },
        { header: "Assists", cell: (row) => row.assists ?? 0 },
        { header: "Appearances", cell: (row) => row.appearances ?? 0 }
      ]} />
    </AppShell>
  );
}

function sortKey(value: string | undefined): SortKey {
  if (value === "player" || value === "season" || value === "assists" || value === "appearances") return value;
  return "goals";
}

function sortRows(rows: any[], key: SortKey) {
  return [...rows].sort((left, right) => {
    if (key === "player") return compareText(left.player_name, right.player_name) || compareText(left.season_name, right.season_name);
    if (key === "season") return compareText(left.season_name, right.season_name) || compareText(left.player_name, right.player_name);
    if (key === "assists") return compareNumberDesc(left.assists, right.assists) || compareText(left.player_name, right.player_name);
    if (key === "appearances") return compareNumberDesc(left.appearances, right.appearances) || compareText(left.player_name, right.player_name);
    return compareNumberDesc(left.goals, right.goals) || compareNumberDesc(left.assists, right.assists) || compareText(left.player_name, right.player_name);
  });
}
