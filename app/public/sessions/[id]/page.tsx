import { notFound } from "next/navigation";
import Link from "next/link";
import { DataTable } from "@/components/DataTable";
import { PublicShell } from "@/components/PublicShell";
import { StatusBadge } from "@/components/StatusBadge";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { money } from "@/lib/utils";

type PublicSessionDetail = {
  session?: {
    id: string;
    name: string | null;
    sessionDate: string;
    seasonName: string | null;
    playgroundName: string | null;
    location: string | null;
    pricePerSession: number | string | null;
    status: string | null;
  } | null;
  teams?: Array<{
    id: string;
    name: string;
    captainName: string | null;
    players: string[];
  }>;
  matches?: MatchRow[];
  attendance?: Array<{
    playerName: string | null;
    status: string;
    notes: string | null;
  }>;
  goals?: Array<{
    goalType: "goal" | "own_goal" | null;
    scorerName: string | null;
    assistName: string | null;
    teamName: string | null;
    goalCount: number | string | null;
  }>;
  dropouts?: Array<{
    originalName: string | null;
    replacementName: string | null;
    transferType: string | null;
  }>;
};

export default async function PublicSessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [{ data, error }, profile] = await Promise.all([
    supabase.rpc("public_session_detail", { p_session_id: id }),
    getCurrentProfile()
  ]);
  const showReturnLink = hasPermission(profile?.role, "manage_attendance");

  if (!error && !data) notFound();

  const detail = (data ?? {}) as PublicSessionDetail;
  const session = detail.session;
  const matches = detail.matches ?? [];
  const standings = buildSessionStandings(matches);

  return (
    <PublicShell returnHref={showReturnLink ? "/dashboard" : undefined} returnLabel="Return">
      <div className="grid gap-6">
        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            Public session details are not ready yet. Run the latest database migration, then refresh this page.
          </div>
        ) : null}

        <section className="panel p-5">
          <h1 className="page-title">{session?.name ?? session?.sessionDate ?? "Session"}</h1>
          <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-600">
            {session?.name ? <span>{session.sessionDate}</span> : null}
            <span>{session?.seasonName ?? "-"}</span>
            <span>{session?.playgroundName ?? session?.location ?? "-"}</span>
            <span>{session?.pricePerSession == null ? "Season default price" : `${money(numberValue(session.pricePerSession))} session price`}</span>
            {session?.status ? <StatusBadge status={session.status} /> : null}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link className="btn-secondary" href={`/public/sessions/${id}/teams`}>View teams</Link>
            <Link className="btn-primary" href={`/public/sessions/${id}/scores`}>Game scores</Link>
          </div>
        </section>

        <section className="grid gap-3">
          <div>
            <h2 className="section-title">Game standings</h2>
            <p className="text-sm text-slate-500">Win = 3 points, draw = 1 point. Head-to-head is shown for quick tie checks.</p>
          </div>
          <DataTable
            rows={standings}
            columns={[
              { header: "Rank", cell: (row) => row.rank },
              { header: "Team", cell: (row) => row.teamName },
              { header: "P", cell: (row) => row.played },
              { header: "W", cell: (row) => row.wins },
              { header: "D", cell: (row) => row.draws },
              { header: "L", cell: (row) => row.losses },
              { header: "GF", cell: (row) => row.goalsFor },
              { header: "GA", cell: (row) => row.goalsAgainst },
              { header: "GD", cell: (row) => signed(row.goalDifference) },
              { header: "Pts", cell: (row) => <span className="font-semibold text-ink">{row.points}</span> },
              { header: "Head-to-head", cell: (row) => row.headToHead || "-" }
            ]}
          />
        </section>

        <section className="grid gap-3">
          <h2 className="section-title">Game scores</h2>
          <DataTable
            rows={matches}
            columns={[
              { header: "Game", cell: (row) => row.matchNumber },
              { header: "Result", cell: (row) => `${row.teamAName ?? "-"} ${row.teamAScore ?? 0}-${row.teamBScore ?? 0} ${row.teamBName ?? "-"}` }
            ]}
          />
        </section>

        <section className="grid gap-3">
          <h2 className="section-title">Teams</h2>
          <DataTable
            rows={detail.teams ?? []}
            columns={[
              { header: "Team", cell: (row) => row.name },
              { header: "Captain", cell: (row) => row.captainName ?? "-" },
              { header: "Players", cell: (row) => row.players?.join(", ") || "-" }
            ]}
          />
        </section>

        <section className="grid gap-3">
          <h2 className="section-title">Goals and assists</h2>
          <DataTable
            rows={detail.goals ?? []}
            columns={[
              { header: "Type", cell: (row) => row.goalType === "own_goal" ? "Own goal" : "Goal" },
              { header: "Scorer", cell: (row) => row.scorerName ?? "-" },
              { header: "Assist", cell: (row) => row.assistName ?? "-" },
              { header: "Team", cell: (row) => row.teamName ?? "-" },
              { header: "Goals", cell: (row) => row.goalCount ?? 1 }
            ]}
          />
        </section>

        <section className="grid gap-3">
          <h2 className="section-title">Attendance</h2>
          <DataTable
            rows={detail.attendance ?? []}
            columns={[
              { header: "Player", cell: (row) => row.playerName ?? "-" },
              { header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
              { header: "Notes", cell: (row) => row.notes ?? "-" }
            ]}
          />
        </section>

        <section className="grid gap-3">
          <h2 className="section-title">Dropouts and replacements</h2>
          <DataTable
            rows={detail.dropouts ?? []}
            columns={[
              { header: "Original", cell: (row) => row.originalName ?? "-" },
              { header: "Replacement", cell: (row) => row.replacementName ?? "-" },
              { header: "Transfer type", cell: (row) => row.transferType?.replaceAll("_", " ") ?? "-" }
            ]}
          />
        </section>
      </div>
    </PublicShell>
  );
}

type MatchRow = {
  matchNumber: number;
  teamAId: string;
  teamBId: string;
  teamAName: string | null;
  teamBName: string | null;
  teamAScore: number | string | null;
  teamBScore: number | string | null;
};

type Standing = {
  teamId: string;
  teamName: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  headToHead: string;
  rank: number;
};

function buildSessionStandings(matches: MatchRow[]): Standing[] {
  const rows = new Map<string, Standing>();
  const ensure = (teamId: string, teamName: string) => {
    if (!rows.has(teamId)) {
      rows.set(teamId, {
        teamId,
        teamName,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        points: 0,
        headToHead: "",
        rank: 0
      });
    }
    return rows.get(teamId)!;
  };

  for (const match of matches) {
    const teamA = ensure(match.teamAId, match.teamAName ?? "Team A");
    const teamB = ensure(match.teamBId, match.teamBName ?? "Team B");
    applyResult(teamA, numberValue(match.teamAScore), numberValue(match.teamBScore));
    applyResult(teamB, numberValue(match.teamBScore), numberValue(match.teamAScore));
  }

  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      goalDifference: row.goalsFor - row.goalsAgainst,
      headToHead: headToHeadSummary(row.teamId, matches)
    }))
    .sort((left, right) =>
      right.points - left.points ||
      right.goalDifference - left.goalDifference ||
      right.goalsFor - left.goalsFor ||
      left.teamName.localeCompare(right.teamName)
    )
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function applyResult(row: Standing, goalsFor: number, goalsAgainst: number) {
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

function headToHeadSummary(teamId: string, matches: MatchRow[]) {
  return matches
    .filter((match) => match.teamAId === teamId || match.teamBId === teamId)
    .map((match) => {
      const isA = match.teamAId === teamId;
      const opponent = isA ? match.teamBName : match.teamAName;
      const gf = isA ? match.teamAScore : match.teamBScore;
      const ga = isA ? match.teamBScore : match.teamAScore;
      return `${opponent ?? "Opponent"} ${numberValue(gf)}-${numberValue(ga)}`;
    })
    .join(", ");
}

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function numberValue(value: number | string | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}
