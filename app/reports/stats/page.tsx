import { DataTable } from "@/components/DataTable";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "../../(shell)";

export default async function StatsReportPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("player_season_stats_summary").select("*").order("goals", { ascending: false });
  return (
    <AppShell>
      <h1 className="page-title mb-5">Stats report</h1>
      <DataTable rows={data ?? []} columns={[
        { header: "Player", cell: (row) => row.player_name ?? "-" },
        { header: "Season", cell: (row) => row.season_name ?? "-" },
        { header: "Goals", cell: (row) => row.goals ?? 0 },
        { header: "Assists", cell: (row) => row.assists ?? 0 },
        { header: "Appearances", cell: (row) => row.appearances ?? 0 }
      ]} />
    </AppShell>
  );
}
