import { DataTable } from "@/components/DataTable";
import { PublicShell } from "@/components/PublicShell";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type FieldStatusRow = {
  playground_name: string | null;
  player_name: string | null;
  goals: number | null;
  assists: number | null;
  appearances: number | null;
  goals_per_appearance: number | string | null;
};

export default async function PublicFieldStatusPage({
  searchParams
}: {
  searchParams: Promise<{ player?: string; playground?: string }>;
}) {
  const filters = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("public_field_status");
  const allRows = (data ?? []) as FieldStatusRow[];
  const playgrounds = Array.from(new Set(allRows.map((row) => row.playground_name).filter(Boolean))).sort();
  const rows = allRows.filter((row) => {
    if (filters.player && !String(row.player_name ?? "").toLowerCase().includes(filters.player.toLowerCase())) return false;
    if (filters.playground && row.playground_name !== filters.playground) return false;
    return true;
  });

  return (
    <PublicShell>
      <div className="grid gap-5">
        <section className="panel overflow-hidden">
          <div className="bg-pitch px-5 py-6 text-white">
            <p className="text-sm font-semibold uppercase tracking-normal text-emerald-100">OU Soccer</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Field Status</h1>
            <p className="mt-2 max-w-2xl text-sm text-emerald-50">Player goals, assists, appearances, and scoring rate by playground.</p>
          </div>
        </section>

        <form className="panel grid gap-3 p-4 md:grid-cols-[1fr_1fr_auto]">
          <input className="input" defaultValue={filters.player ?? ""} name="player" placeholder="Filter by player" />
          <select className="input" defaultValue={filters.playground ?? ""} name="playground">
            <option value="">All playgrounds</option>
            {playgrounds.map((playground) => <option key={playground} value={playground}>{playground}</option>)}
          </select>
          <button className="btn-primary">Apply</button>
        </form>

        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            Field status is not ready yet. Run the latest database migration, then refresh this page.
          </div>
        ) : null}

        <DataTable rows={rows} columns={[
          { header: "Field", cell: (row) => row.playground_name ?? "-" },
          { header: "Player", cell: (row) => row.player_name ?? "-" },
          { header: "Goals", cell: (row) => row.goals ?? 0 },
          { header: "Assists", cell: (row) => row.assists ?? 0 },
          { header: "Appearances", cell: (row) => row.appearances ?? 0 },
          { header: "Goals / appearance", cell: (row) => row.goals_per_appearance ?? 0 }
        ]} />
      </div>
    </PublicShell>
  );
}
