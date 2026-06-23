import { notFound } from "next/navigation";
import Link from "next/link";
import { DataTable } from "@/components/DataTable";
import { FixtureScheduleCard } from "@/components/FixtureScheduleCard";
import { MatchGoalDetails } from "@/components/MatchGoalDetails";
import { PublicShell } from "@/components/PublicShell";
import { StatusBadge } from "@/components/StatusBadge";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { getRequestProgramSlug, getRequestTenantSlug } from "@/lib/tenant-server";
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
    matchNumber: number | null;
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
  const tenantSlug = await getRequestTenantSlug();
  const programSlug = await getRequestProgramSlug();
  const [{ data, error }, profile] = await Promise.all([
    supabase.rpc("scoped_public_session_detail", { p_organization_slug: tenantSlug, p_program_slug: programSlug || null, p_session_id: id }),
    getCurrentProfile()
  ]);
  const showReturnLink = hasPermission(profile?.role, "manage_attendance");
  const canManageSessionActivity = hasPermission(profile?.role, "manage_attendance");

  if (!error && !data) notFound();

  const detail = (data ?? {}) as PublicSessionDetail;
  const session = detail.session;
  const matches = detail.matches ?? [];
  const goalsByMatchNumber = groupGoalsByMatchNumber(detail.goals ?? []);
  const standings = buildSessionStandings(matches);
  const fixtureMatches = matches.map((match) => ({
    matchNumber: match.matchNumber,
    teamAName: match.teamAName,
    teamBName: match.teamBName,
    homeTeamName: homeTeamName(match),
    awayTeamName: awayTeamName(match),
    scheduledStartTime: match.scheduledStartTime,
    scheduledEndTime: match.scheduledEndTime
  }));

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
            {canManageSessionActivity ? <Link className="btn-secondary" href={`/sessions/${id}/fixture`}>Generate fixture</Link> : null}
            <Link className="btn-secondary" href={`/sessions/${id}/lineups`}>Lineups</Link>
            <Link className="btn-secondary" href={`/public/sessions/${id}/summary`}>Session summary</Link>
            <Link className="btn-primary" href={`/public/sessions/${id}/scores`}>Game scores</Link>
          </div>
        </section>

        <section className="grid gap-3">
          <div>
            <h2 className="section-title">Game standings</h2>
            <p className="text-sm text-slate-500">Win = 3 points, draw = 1 point. Away goals break ties after goals scored when an away team is selected.</p>
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
              { header: "AG", cell: (row) => row.awayGoals },
              { header: "Pts", cell: (row) => <span className="font-semibold text-ink">{row.points}</span> },
              { header: "Head-to-head", cell: (row) => row.headToHead || "-" }
            ]}
          />
        </section>

        <FixtureScheduleCard matches={fixtureMatches} sessionLabel={session?.name ?? session?.sessionDate ?? "Session"} />

        <section className="grid gap-3">
          <h2 className="section-title">Game scores</h2>
          <DataTable
            rows={matches}
            columns={[
              { header: "Game", cell: (row) => row.matchNumber },
              { header: "Result", cell: (row) => `${row.teamAName ?? "-"} ${row.teamAScore ?? 0}-${row.teamBScore ?? 0} ${row.teamBName ?? "-"}` },
              { header: "Goals/Assists", cell: (row) => <MatchGoalDetails goals={goalsByMatchNumber.get(row.matchNumber) ?? []} /> },
              { header: "Home/Away", cell: (row) => homeAwayLabel(row) }
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
  awayTeamId?: string | null;
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
  resultStatus?: string | null;
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
  awayGoals: number;
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
        awayGoals: 0,
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
    if (match.resultStatus !== "played") continue;
    applyResult(teamA, numberValue(match.teamAScore), numberValue(match.teamBScore), match.awayTeamId === match.teamAId);
    applyResult(teamB, numberValue(match.teamBScore), numberValue(match.teamAScore), match.awayTeamId === match.teamBId);
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
      right.awayGoals - left.awayGoals ||
      left.teamName.localeCompare(right.teamName)
    )
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function applyResult(row: Standing, goalsFor: number, goalsAgainst: number, isAway = false) {
  row.played += 1;
  row.goalsFor += goalsFor;
  row.goalsAgainst += goalsAgainst;
  if (isAway) row.awayGoals += goalsFor;
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

function homeAwayLabel(match: MatchRow) {
  const home = homeTeamName(match);
  const away = awayTeamName(match);
  if (home && away) return `${home} home, ${away} away`;
  return "-";
}

function homeTeamName(match: MatchRow) {
  if (match.awayTeamId === match.teamAId) return match.teamBName ?? "Team B";
  if (match.awayTeamId === match.teamBId) return match.teamAName ?? "Team A";
  return null;
}

function awayTeamName(match: MatchRow) {
  if (match.awayTeamId === match.teamAId) return match.teamAName ?? "Team A";
  if (match.awayTeamId === match.teamBId) return match.teamBName ?? "Team B";
  return null;
}

function headToHeadSummary(teamId: string, matches: MatchRow[]) {
  return matches
    .filter((match) => match.resultStatus === "played" && (match.teamAId === teamId || match.teamBId === teamId))
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

function groupGoalsByMatchNumber(goals: NonNullable<PublicSessionDetail["goals"]>) {
  const grouped = new Map<number, NonNullable<PublicSessionDetail["goals"]>>();
  for (const goal of goals) {
    if (goal.matchNumber == null) continue;
    grouped.set(goal.matchNumber, [...(grouped.get(goal.matchNumber) ?? []), goal]);
  }
  return grouped;
}
