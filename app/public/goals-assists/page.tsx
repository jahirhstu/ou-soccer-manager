import { DataTable } from "@/components/DataTable";
import { PublicShell } from "@/components/PublicShell";
import { compareNumberDesc, compareText } from "@/lib/sorting";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRequestProgramSlug, getRequestTenantSlug } from "@/lib/tenant-server";

type GoalsAssistsRow = {
  player_name: string | null;
  season_id: string | null;
  season_name: string | null;
  goals: number | null;
  assists: number | null;
  sessions_count: number | null;
  games_count: number | null;
  goals_per_game: number | string | null;
  assists_per_game: number | string | null;
  goal_contributions_per_game: number | string | null;
};

type PublicSessionRow = {
  id: string;
  name: string | null;
  session_date: string;
  season_name: string | null;
};

type SortKey = "goals" | "player" | "season" | "sessions" | "games" | "assists" | "rate";

export default async function PublicGoalsAssistsPage({
  searchParams
}: {
  searchParams: Promise<{ player?: string; season?: string; session?: string; sort?: string }>;
}) {
  const filters = await searchParams;
  const supabase = await createSupabaseServerClient();
  const tenantSlug = await getRequestTenantSlug();
  const programSlug = await getRequestProgramSlug();
  const [{ data, error }, { data: sessionsData }] = await Promise.all([
    supabase.rpc("scoped_public_goals_assists", { p_organization_slug: tenantSlug, p_program_slug: programSlug || null, p_session_id: filters.session || null }),
    supabase.rpc("scoped_public_sessions", { p_organization_slug: tenantSlug, p_program_slug: programSlug || null })
  ]);
  const allRows = (data ?? []) as GoalsAssistsRow[];
  const sessions = (sessionsData ?? []) as PublicSessionRow[];
  const seasons = uniqueSeasons(allRows);
  const rows = sortRows(allRows.filter((row) => {
    if (filters.player && !String(row.player_name ?? "").toLowerCase().includes(filters.player.toLowerCase())) return false;
    if (filters.season && row.season_id !== filters.season) return false;
    return true;
  }), sortKey(filters.sort));

  return (
    <PublicShell>
      <div className="grid gap-5">
        <section className="panel overflow-hidden">
          <div className="bg-pitch px-5 py-6 text-white">
            <p className="text-sm font-semibold uppercase tracking-normal text-emerald-100">Report Gallery</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Goals & Assists</h1>
            <p className="mt-2 max-w-2xl text-sm text-emerald-50">
              Player scoring, assists, sessions, games, and per-game production by season.
            </p>
          </div>
        </section>

        <form className="panel grid gap-3 p-4 md:grid-cols-[1fr_1fr_1fr_auto]">
          <input className="input" defaultValue={filters.player ?? ""} name="player" placeholder="Filter by player" />
          <select className="input" defaultValue={filters.season ?? ""} name="season">
            <option value="">All seasons</option>
            {seasons.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}
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
            Goals and assists are not ready yet. Run the latest database migration, then refresh this page.
          </div>
        ) : null}

        <DataTable rows={rows} empty="No goals or assists match this filter." columns={[
          { header: "Player", cell: (row) => row.player_name ?? "-" },
          { header: "Season", cell: (row) => row.season_name ?? "-" },
          { header: "Sessions", cell: (row) => row.sessions_count ?? 0 },
          { header: "Games", cell: (row) => row.games_count ?? 0 },
          { header: "Goals", cell: (row) => row.goals ?? 0 },
          { header: "Assists", cell: (row) => row.assists ?? 0 },
          { header: "Goals / game", cell: (row) => row.goals_per_game ?? 0 },
          { header: "Assists / game", cell: (row) => row.assists_per_game ?? 0 },
          { header: "G+A / game", cell: (row) => row.goal_contributions_per_game ?? 0 }
        ]} />
      </div>
    </PublicShell>
  );
}

function uniqueSeasons(rows: GoalsAssistsRow[]) {
  const seasons = new Map<string, string>();
  for (const row of rows) {
    if (row.season_id) seasons.set(row.season_id, row.season_name ?? "Season");
  }
  return Array.from(seasons.entries()).map(([id, name]) => ({ id, name }));
}

function sortKey(value: string | undefined): SortKey {
  if (value === "player" || value === "season" || value === "sessions" || value === "games" || value === "assists" || value === "rate") return value;
  return "goals";
}

function sortRows(rows: GoalsAssistsRow[], key: SortKey) {
  return [...rows].sort((left, right) => {
    if (key === "player") return compareText(left.player_name, right.player_name) || compareText(left.season_name, right.season_name);
    if (key === "season") return compareText(left.season_name, right.season_name) || compareText(left.player_name, right.player_name);
    if (key === "sessions") return compareNumberDesc(left.sessions_count, right.sessions_count) || compareText(left.player_name, right.player_name);
    if (key === "games") return compareNumberDesc(left.games_count, right.games_count) || compareText(left.player_name, right.player_name);
    if (key === "assists") return compareNumberDesc(left.assists, right.assists) || compareNumberDesc(left.goals, right.goals) || compareText(left.player_name, right.player_name);
    if (key === "rate") return compareNumberDesc(left.goal_contributions_per_game, right.goal_contributions_per_game) || compareText(left.player_name, right.player_name);
    return compareNumberDesc(left.goals, right.goals) || compareNumberDesc(left.assists, right.assists) || compareText(left.player_name, right.player_name);
  });
}

function sessionLabel(session: PublicSessionRow) {
  const label = session.name || session.session_date;
  return session.season_name ? `${label} - ${session.season_name}` : label;
}
