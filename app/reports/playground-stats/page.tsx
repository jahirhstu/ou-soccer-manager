import { DataTable } from "@/components/DataTable";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "../../(shell)";

export default async function PlaygroundStatsReportPage({
  searchParams
}: {
  searchParams: Promise<{ player?: string; playground?: string }>;
}) {
  const filters = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [{ data }, { data: playgrounds }] = await Promise.all([
    supabase.from("player_playground_stats_summary").select("*").order("goals", { ascending: false }),
    supabase.from("playgrounds").select("name").order("name")
  ]);
  const rows = (data ?? []).filter((row) => {
    if (filters.player && !String(row.player_name ?? "").toLowerCase().includes(filters.player.toLowerCase())) return false;
    if (filters.playground && String(row.playground_name ?? "") !== filters.playground) return false;
    return true;
  });

  return (
    <AppShell>
      <div className="grid gap-5">
        <div>
          <h1 className="page-title">Playground stats</h1>
          <p className="text-sm text-slate-500">Compare player goals, assists, and appearances by field.</p>
        </div>
        <form className="panel grid gap-3 p-4 md:grid-cols-[1fr_1fr_auto]">
          <input className="input" defaultValue={filters.player ?? ""} name="player" placeholder="Filter by player" />
          <select className="input" defaultValue={filters.playground ?? ""} name="playground">
            <option value="">All playgrounds</option>
            {(playgrounds ?? []).map((playground) => <option key={playground.name} value={playground.name}>{playground.name}</option>)}
          </select>
          <button className="btn-primary">Apply</button>
        </form>
        <DataTable rows={rows} columns={[
          { header: "Playground", cell: (row) => row.playground_name ?? "-" },
          { header: "Player", cell: (row) => row.player_name ?? "-" },
          { header: "Goals", cell: (row) => row.goals ?? 0 },
          { header: "Assists", cell: (row) => row.assists ?? 0 },
          { header: "Appearances", cell: (row) => row.appearances ?? 0 },
          { header: "Goals / appearance", cell: (row) => row.goals_per_appearance ?? 0 }
        ]} />
      </div>
    </AppShell>
  );
}
