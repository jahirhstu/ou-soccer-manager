import { notFound } from "next/navigation";
import Link from "next/link";
import { Award, CalendarDays, Medal, ShieldCheck, Trophy } from "lucide-react";
import { DataTable } from "@/components/DataTable";
import { MatchGoalDetails } from "@/components/MatchGoalDetails";
import { PublicShell } from "@/components/PublicShell";
import { StatusBadge } from "@/components/StatusBadge";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { getRequestProgramSlug, getRequestTenantSlug } from "@/lib/tenant-server";
import { money } from "@/lib/utils";

type PublicSessionSummary = {
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
  matches?: MatchRow[];
  goals?: GoalRow[];
};

type GoalRow = {
  matchNumber: number | null;
  goalType: "goal" | "own_goal" | null;
  scorerName: string | null;
  assistName: string | null;
  teamName: string | null;
  goalCount: number | string | null;
};

type MatchRow = {
  matchNumber: number;
  teamAId: string | null;
  teamBId: string | null;
  teamASource?: string | null;
  teamBSource?: string | null;
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
  rank: number;
};

type PlayerTotal = {
  playerName: string;
  teamNames: string;
  total: number;
};

export default async function PublicSessionSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const tenantSlug = await getRequestTenantSlug();
  const programSlug = await getRequestProgramSlug();
  const [{ data, error }, profile] = await Promise.all([
    supabase.rpc("scoped_public_session_detail", { p_organization_slug: tenantSlug, p_program_slug: programSlug || null, p_session_id: id }),
    getCurrentProfile()
  ]);
  const showReturnLink = hasPermission(profile?.role, "manage_attendance");

  if (!error && !data) notFound();

  const detail = (data ?? {}) as PublicSessionSummary;
  const session = detail.session;
  const goals = detail.goals ?? [];
  const goalsByMatchNumber = groupGoalsByMatchNumber(goals);
  const matches = applyGoalScoresToMatches(detail.matches ?? [], goalsByMatchNumber);
  const standings = buildSessionStandings(matches);
  const podium = standings.slice(0, 3);
  const matchRows = matches.map((match) => ({
    matchNumber: match.matchNumber,
    game: `Game ${match.matchNumber}`,
    result: `${match.teamAName ?? sourceLabel(match.teamASource, "Team A")} ${numberValue(match.teamAScore)}-${numberValue(match.teamBScore)} ${match.teamBName ?? sourceLabel(match.teamBSource, "Team B")}`,
    homeAway: homeAwayLabel(match)
  }));
  const scorerRows = aggregatePlayers(goals.filter((goal) => goal.goalType !== "own_goal"), "scorerName");
  const assistRows = aggregatePlayers(goals.filter((goal) => goal.assistName), "assistName");
  const totalGoals = goals.reduce((total, goal) => total + numberValue(goal.goalCount || 1), 0);
  const sessionLabel = session?.name ?? session?.sessionDate ?? "Session";

  return (
    <PublicShell returnHref={showReturnLink ? "/dashboard" : undefined} returnLabel="Return">
      <div className="grid gap-5">
        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            Public session details are not ready yet. Run the latest database migration, then refresh this page.
          </div>
        ) : null}

        <header className="panel overflow-hidden">
          <div className="bg-pitch px-5 py-6 text-white sm:px-6">
            <span className="inline-flex items-center gap-2 rounded-md bg-white/15 px-3 py-1 text-xs font-semibold text-emerald-50 ring-1 ring-white/20">
              <ShieldCheck className="h-3.5 w-3.5" />
              Session summary
            </span>
            <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{sessionLabel}</h1>
                <div className="mt-3 flex flex-wrap gap-3 text-sm text-emerald-50">
                  <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{session?.sessionDate ?? "-"}</span>
                  <span>{session?.seasonName ?? "-"}</span>
                  <span>{session?.playgroundName ?? session?.location ?? "-"}</span>
                  <span>{session?.pricePerSession == null ? "Season default price" : `${money(numberValue(session.pricePerSession))} session price`}</span>
                  {session?.status ? <StatusBadge status={session.status} /> : null}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:w-[28rem]">
                <MetricCard label="Games" value={String(matches.length)} />
                <MetricCard label="Goals" value={String(totalGoals)} />
                <MetricCard label="Teams" value={String(standings.length)} />
              </div>
            </div>
          </div>
        </header>

        <section className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="section-title">Podium</h2>
              <p className="text-sm text-slate-500">Ranking follows points, goal difference, goals for, away goals, then team name.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link className="btn-secondary" href={`/public/sessions/${id}`}>Session details</Link>
              <Link className="btn-secondary" href={`/public/sessions/${id}/scores`}>Game scores</Link>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {podium.map((team, index) => (
              <PodiumCard key={team.teamId} place={index + 1} standing={team} />
            ))}
            {!podium.length ? <div className="panel border-dashed p-10 text-center text-sm text-slate-500 md:col-span-3">No standings yet.</div> : null}
          </div>
        </section>

        <section className="grid gap-3">
          <h2 className="section-title">Standings</h2>
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
              { header: "Pts", cell: (row) => <span className="font-semibold text-ink">{row.points}</span> }
            ]}
          />
        </section>

        <section className="grid items-start gap-3 lg:grid-cols-2">
          <div className="grid gap-3">
            <h2 className="section-title">Top scorers</h2>
            <DataTable
              compact
              empty="No goals recorded yet."
              rows={scorerRows}
              columns={[
                { header: "Player", cell: (row) => row.playerName },
                { header: "Team", cell: (row) => row.teamNames },
                { header: "Goals", cell: (row) => <span className="font-semibold text-ink">{row.total}</span> }
              ]}
            />
          </div>
          <div className="grid gap-3">
            <h2 className="section-title">Top assists</h2>
            <DataTable
              compact
              empty="No assists recorded yet."
              rows={assistRows}
              columns={[
                { header: "Player", cell: (row) => row.playerName },
                { header: "Team", cell: (row) => row.teamNames },
                { header: "Assists", cell: (row) => <span className="font-semibold text-ink">{row.total}</span> }
              ]}
            />
          </div>
        </section>

        <section className="grid gap-3">
          <h2 className="section-title">Match results</h2>
          <DataTable
            rows={matchRows}
            columns={[
              { header: "Game", cell: (row) => row.game },
              { header: "Result", cell: (row) => row.result },
              { header: "Goals/Assists", cell: (row) => <MatchGoalDetails goals={goalsByMatchNumber.get(row.matchNumber) ?? []} /> },
              { header: "Home/Away", cell: (row) => row.homeAway }
            ]}
            empty="No game scores recorded yet."
          />
        </section>
      </div>
    </PublicShell>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-white/15 px-3 py-2 ring-1 ring-white/20">
      <div className="text-xs font-medium text-emerald-50">{label}</div>
      <div className="mt-1 text-xl font-black text-white">{value}</div>
    </div>
  );
}

function PodiumCard({ place, standing }: { place: number; standing: Standing }) {
  const icon = place === 1
    ? <Trophy className="h-5 w-5 text-amber-600" />
    : place === 2
      ? <Medal className="h-5 w-5 text-slate-500" />
      : <Award className="h-5 w-5 text-pitch" />;
  const label = place === 1 ? "Winner" : place === 2 ? "Second place" : "Third place";

  return (
    <article className="panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
            {icon}
            {label}
          </div>
          <h3 className="mt-3 truncate text-xl font-semibold text-ink">{standing.teamName}</h3>
        </div>
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-pitch text-sm font-black text-white">{place}</div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
        <SmallStat label="Pts" value={standing.points} />
        <SmallStat label="GF" value={standing.goalsFor} />
        <SmallStat label="GD" value={signed(standing.goalDifference)} />
      </div>
      <div className="mt-3 text-xs font-medium text-slate-500">
        {standing.wins}W {standing.draws}D {standing.losses}L | {standing.goalsFor}-{standing.goalsAgainst}
      </div>
    </article>
  );
}

function SmallStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-line bg-slate-50 px-2 py-2">
      <div className="text-[11px] font-semibold uppercase text-slate-500">{label}</div>
      <div className="mt-1 font-black text-ink">{value}</div>
    </div>
  );
}

function aggregatePlayers(goals: GoalRow[], field: "scorerName" | "assistName"): PlayerTotal[] {
  const rows = new Map<string, { playerName: string; teamNames: Set<string>; total: number }>();
  for (const goal of goals) {
    const playerName = goal[field];
    if (!playerName) continue;
    const current = rows.get(playerName) ?? { playerName, teamNames: new Set<string>(), total: 0 };
    if (goal.teamName) current.teamNames.add(goal.teamName);
    current.total += Math.max(1, numberValue(goal.goalCount || 1));
    rows.set(playerName, current);
  }

  return Array.from(rows.values())
    .map((row) => ({
      playerName: row.playerName,
      teamNames: Array.from(row.teamNames).sort((left, right) => left.localeCompare(right)).join(", ") || "-",
      total: row.total
    }))
    .sort((left, right) => right.total - left.total || left.playerName.localeCompare(right.playerName));
}

function groupGoalsByMatchNumber(goals: GoalRow[]) {
  const grouped = new Map<number, GoalRow[]>();
  for (const goal of goals) {
    if (goal.matchNumber == null) continue;
    grouped.set(goal.matchNumber, [...(grouped.get(goal.matchNumber) ?? []), goal]);
  }
  return grouped;
}

function applyGoalScoresToMatches(matches: MatchRow[], goalsByMatchNumber: Map<number, GoalRow[]>) {
  return matches.map((match) => {
    const goals = goalsByMatchNumber.get(match.matchNumber) ?? [];
    if (!goals.length) return match;
    const score = calculateScoreFromGoals(match, goals);
    return {
      ...match,
      teamAScore: score.teamAScore,
      teamBScore: score.teamBScore
    };
  });
}

function calculateScoreFromGoals(match: MatchRow, goals: GoalRow[]) {
  return goals.reduce(
    (score, goal) => {
      const count = Math.max(1, numberValue(goal.goalCount || 1));
      if (goal.teamName === match.teamAName) score.teamAScore += count;
      if (goal.teamName === match.teamBName) score.teamBScore += count;
      return score;
    },
    { teamAScore: 0, teamBScore: 0 }
  );
}

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
        rank: 0
      });
    }
    return rows.get(teamId)!;
  };

  for (const match of matches) {
    if (!match.teamAId || !match.teamBId) continue;
    const teamA = ensure(match.teamAId, match.teamAName ?? "Team A");
    const teamB = ensure(match.teamBId, match.teamBName ?? "Team B");
    if (match.resultStatus !== "played") continue;
    applyResult(teamA, numberValue(match.teamAScore), numberValue(match.teamBScore), match.awayTeamId === match.teamAId);
    applyResult(teamB, numberValue(match.teamBScore), numberValue(match.teamAScore), match.awayTeamId === match.teamBId);
  }

  return Array.from(rows.values())
    .map((row) => ({ ...row, goalDifference: row.goalsFor - row.goalsAgainst }))
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

function sourceLabel(source: string | null | undefined, fallback: string) {
  if (source === "standings_rank_1") return "1st place";
  if (source === "standings_rank_2") return "2nd place";
  return fallback;
}

function awayTeamName(match: MatchRow) {
  if (match.awayTeamId === match.teamAId) return match.teamAName ?? "Team A";
  if (match.awayTeamId === match.teamBId) return match.teamBName ?? "Team B";
  return null;
}

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function numberValue(value: number | string | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}
