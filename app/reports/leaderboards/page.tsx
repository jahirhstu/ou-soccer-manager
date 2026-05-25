import { DataTable } from "@/components/DataTable";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "../../(shell)";

type MatchRow = {
  team_a_id: string;
  team_b_id: string;
  team_a_score: number;
  team_b_score: number;
  team_a?: { name?: string | null; captain?: { display_name?: string | null } | null } | null;
  team_b?: { name?: string | null; captain?: { display_name?: string | null } | null } | null;
};

type BoardRow = {
  rank: number;
  name: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  pointsPerGame: string;
  winRate: string;
};

export default async function LeaderboardsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: matches } = await supabase
    .from("session_matches")
    .select("team_a_id,team_b_id,team_a_score,team_b_score,team_a:session_teams!session_matches_team_a_id_fkey(name,captain:players!session_teams_captain_player_id_fkey(display_name)),team_b:session_teams!session_matches_team_b_id_fkey(name,captain:players!session_teams_captain_player_id_fkey(display_name))");
  const matchRows = (matches ?? []) as MatchRow[];
  const teamRows = leaderboardRows(matchRows, "team");
  const captainRows = leaderboardRows(matchRows, "captain");

  return (
    <AppShell>
      <div className="grid gap-6">
        <section className="panel p-5">
          <h1 className="page-title">Leaderboards</h1>
          <p className="mt-2 text-sm text-slate-500">Overall game performance across imported session matches.</p>
        </section>
        <Leaderboard title="Team leaderboard" rows={teamRows} />
        <Leaderboard title="Captain leaderboard" rows={captainRows} />
      </div>
    </AppShell>
  );
}

function Leaderboard({ title, rows }: { title: string; rows: BoardRow[] }) {
  return (
    <section className="grid gap-3">
      <h2 className="section-title">{title}</h2>
      <DataTable rows={rows} columns={[
        { header: "Rank", cell: (row) => row.rank },
        { header: "Name", cell: (row) => row.name },
        { header: "P", cell: (row) => row.played },
        { header: "W", cell: (row) => row.wins },
        { header: "D", cell: (row) => row.draws },
        { header: "L", cell: (row) => row.losses },
        { header: "GF", cell: (row) => row.goalsFor },
        { header: "GA", cell: (row) => row.goalsAgainst },
        { header: "GD", cell: (row) => signed(row.goalDifference) },
        { header: "Pts", cell: (row) => <span className="font-semibold text-ink">{row.points}</span> },
        { header: "Pts/Game", cell: (row) => row.pointsPerGame },
        { header: "Win %", cell: (row) => row.winRate }
      ]} />
    </section>
  );
}

function leaderboardRows(matches: MatchRow[], mode: "team" | "captain") {
  const rows = new Map<string, BoardRow>();
  const ensure = (name: string) => {
    if (!rows.has(name)) {
      rows.set(name, {
        rank: 0,
        name,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        points: 0,
        pointsPerGame: "0.00",
        winRate: "0%"
      });
    }
    return rows.get(name)!;
  };

  for (const match of matches) {
    const teamAName = mode === "team" ? match.team_a?.name : match.team_a?.captain?.display_name;
    const teamBName = mode === "team" ? match.team_b?.name : match.team_b?.captain?.display_name;
    if (teamAName) applyResult(ensure(teamAName), Number(match.team_a_score ?? 0), Number(match.team_b_score ?? 0));
    if (teamBName) applyResult(ensure(teamBName), Number(match.team_b_score ?? 0), Number(match.team_a_score ?? 0));
  }

  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      goalDifference: row.goalsFor - row.goalsAgainst,
      pointsPerGame: row.played ? (row.points / row.played).toFixed(2) : "0.00",
      winRate: row.played ? `${Math.round((row.wins / row.played) * 100)}%` : "0%"
    }))
    .sort((left, right) =>
      right.points - left.points ||
      right.goalDifference - left.goalDifference ||
      right.goalsFor - left.goalsFor ||
      left.name.localeCompare(right.name)
    )
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function applyResult(row: BoardRow, goalsFor: number, goalsAgainst: number) {
  row.played += 1;
  row.goalsFor += goalsFor;
  row.goalsAgainst += goalsAgainst;
  if (goalsFor > goalsAgainst) {
    row.wins += 1;
    row.points += 3;
  } else if (goalsFor === goalsAgainst) {
    row.draws += 1;
    row.points += 1;
  } else {
    row.losses += 1;
  }
}

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}
