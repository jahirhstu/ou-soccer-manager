import { DataTable } from "@/components/DataTable";
import { compareNumberDesc, compareText } from "@/lib/sorting";
import { PublicShell } from "@/components/PublicShell";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRequestProgramSlug, getRequestTenantSlug } from "@/lib/tenant-server";

type FieldStatusRow = {
  playground_name: string | null;
  player_name: string | null;
  goals: number | null;
  assists: number | null;
  appearances: number | null;
  goals_per_appearance: number | string | null;
};

type PublicSessionRow = {
  id: string;
  name: string | null;
  session_date: string;
  season_name: string | null;
};

type SortKey = "goals" | "field" | "player" | "assists" | "appearances" | "rate";

export default async function PublicFieldStatusPage({
  searchParams
}: {
  searchParams: Promise<{ player?: string; playground?: string; session?: string; sort?: string }>;
}) {
  const filters = await searchParams;
  const supabase = await createSupabaseServerClient();
  const tenantSlug = await getRequestTenantSlug();
  const programSlug = await getRequestProgramSlug();
  const [{ data, error }, { data: sessionsData }] = await Promise.all([
    supabase.rpc("scoped_public_field_status", { p_organization_slug: tenantSlug, p_program_slug: programSlug || null, p_session_id: filters.session || null }),
    supabase.rpc("scoped_public_sessions", { p_organization_slug: tenantSlug, p_program_slug: programSlug || null })
  ]);
  const allRows = (data ?? []) as FieldStatusRow[];
  const sessions = (sessionsData ?? []) as PublicSessionRow[];
  const playgrounds = Array.from(new Set(allRows.map((row) => row.playground_name).filter((name): name is string => Boolean(name)))).sort();
  const rows = sortRows(allRows.filter((row) => {
    if (filters.player && !String(row.player_name ?? "").toLowerCase().includes(filters.player.toLowerCase())) return false;
    if (filters.playground && row.playground_name !== filters.playground) return false;
    return true;
  }), sortKey(filters.sort));

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

        <form className="panel grid gap-3 p-4 md:grid-cols-[1fr_1fr_1fr_auto]">
          <input className="input" defaultValue={filters.player ?? ""} name="player" placeholder="Filter by player" />
          <select className="input" defaultValue={filters.playground ?? ""} name="playground">
            <option value="">All playgrounds</option>
            {playgrounds.map((playground) => <option key={playground} value={playground}>{playground}</option>)}
          </select>
          <select className="input" defaultValue={filters.session ?? ""} name="session">
            <option value="">All sessions</option>
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>{sessionLabel(session)}</option>
            ))}
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

function sortKey(value: string | undefined): SortKey {
  if (value === "field" || value === "player" || value === "assists" || value === "appearances" || value === "rate") return value;
  return "goals";
}

function sortRows(rows: FieldStatusRow[], key: SortKey) {
  return [...rows].sort((left, right) => {
    if (key === "field") return compareText(left.playground_name, right.playground_name) || compareText(left.player_name, right.player_name);
    if (key === "player") return compareText(left.player_name, right.player_name) || compareText(left.playground_name, right.playground_name);
    if (key === "assists") return compareNumberDesc(left.assists, right.assists) || compareText(left.player_name, right.player_name);
    if (key === "appearances") return compareNumberDesc(left.appearances, right.appearances) || compareText(left.player_name, right.player_name);
    if (key === "rate") return compareNumberDesc(left.goals_per_appearance, right.goals_per_appearance) || compareText(left.player_name, right.player_name);
    return compareNumberDesc(left.goals, right.goals) || compareNumberDesc(left.assists, right.assists) || compareText(left.player_name, right.player_name);
  });
}

function sessionLabel(session: PublicSessionRow) {
  const label = session.name || session.session_date;
  return session.season_name ? `${label} - ${session.season_name}` : label;
}
