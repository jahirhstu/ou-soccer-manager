import { PublicShell } from "@/components/PublicShell";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type LeaderboardRow = {
  board: "team" | "captain";
  name: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  away_goals: number;
  points: number;
  points_per_game: number;
  win_rate: number;
};

export default async function PublicLeaderboardsPage() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("public_leaderboards");
  const rows = (data ?? []) as LeaderboardRow[];
  const teamRows = rows.filter((row) => row.board === "team");
  const captainRows = rows.filter((row) => row.board === "captain");

  return (
    <PublicShell>
      <div className="grid gap-5">
        <section className="panel overflow-hidden">
          <div className="bg-pitch px-5 py-6 text-white">
            <p className="text-sm font-semibold uppercase tracking-normal text-emerald-100">OU Soccer</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Leaderboards</h1>
            <p className="mt-2 max-w-2xl text-sm text-emerald-50">Public game standings by team and captain.</p>
          </div>
        </section>

        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            Public leaderboards are not ready yet. Run the latest database migration, then refresh this page.
          </div>
        ) : null}

        <Leaderboard title="Team leaderboard" rows={teamRows} />
        <Leaderboard title="Captain leaderboard" rows={captainRows} />
      </div>
    </PublicShell>
  );
}

function Leaderboard({ rows, title }: { rows: LeaderboardRow[]; title: string }) {
  return (
    <section className="grid gap-3">
      <h2 className="section-title">{title}</h2>
      <div className="grid gap-2">
        {rows.map((row, index) => (
          <article className="panel grid gap-3 p-4 sm:grid-cols-[52px_1fr_auto] sm:items-center" key={`${row.board}-${row.name}`}>
            <div className="grid h-10 w-10 place-items-center rounded-md bg-emerald-50 text-sm font-black text-pitch ring-1 ring-emerald-100">
              {index + 1}
            </div>
            <div>
              <h3 className="font-semibold text-ink">{row.name}</h3>
              <p className="mt-1 text-xs text-slate-500">
                {row.played} played | {row.wins}W {row.draws}D {row.losses}L | GF {row.goals_for} GA {row.goals_against}
              </p>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center text-xs sm:min-w-64">
              <Stat label="Pts" value={row.points} />
              <Stat label="GD" value={signed(row.goal_difference)} />
              <Stat label="AG" value={row.away_goals} />
              <Stat label="Win" value={`${row.win_rate}%`} />
            </div>
          </article>
        ))}
        {!rows.length ? <div className="panel border-dashed p-10 text-center text-sm text-slate-500">No leaderboard data yet.</div> : null}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2 ring-1 ring-line">
      <div className="font-semibold text-ink">{value}</div>
      <div className="mt-0.5 text-[10px] font-semibold uppercase text-slate-500">{label}</div>
    </div>
  );
}

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}
