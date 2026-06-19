import { DataTable } from "@/components/DataTable";
import { FixtureScheduleCard } from "@/components/FixtureScheduleCard";
import { StatusBadge } from "@/components/StatusBadge";
import { completeSession, updateSessionPrice } from "@/lib/actions/crud";
import { hasPermission } from "@/lib/permissions";
import { money } from "@/lib/utils";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { AppShell } from "../../(shell)";
import Link from "next/link";

export default async function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [{ data: session }, { data: attendance }, { data: charges }, { data: dropouts }, { data: goals }, { data: teams }, { data: matches }, profile] = await Promise.all([
    supabase.from("sessions").select("*,seasons(name),playgrounds(name)").eq("id", id).single(),
    supabase.from("attendance").select("*,players(display_name)").eq("session_id", id),
    supabase
      .from("session_player_charges")
      .select("*")
      .eq("session_id", id),
    supabase.from("dropouts").select("*,original:players!dropouts_original_player_id_fkey(display_name),replacement:players!dropouts_replacement_player_id_fkey(display_name)").eq("session_id", id),
    supabase.from("goals").select("*,session_teams(name),scorer:players!goals_scorer_id_fkey(display_name),assist:players!goals_assist_player_id_fkey(display_name)").eq("session_id", id),
    supabase
      .from("session_teams")
      .select("*,captain:players!session_teams_captain_player_id_fkey(display_name),session_team_players(players(display_name))")
      .eq("session_id", id)
      .order("name"),
    supabase
      .from("session_matches")
      .select("*,team_a:session_teams!session_matches_team_a_id_fkey(name),team_b:session_teams!session_matches_team_b_id_fkey(name)")
      .eq("session_id", id)
      .order("match_number"),
    getCurrentProfile()
  ]);
  const isAdmin = hasPermission(profile?.role, "manage_all");
  const canManageSessionActivity = hasPermission(profile?.role, "manage_attendance");
  const chargeByPlayerId = new Map((charges ?? []).map((charge: any) => [charge.player_id, charge]));
  const matchRows = (matches ?? []) as MatchRow[];
  const goalsByMatchId = new Map<string, GoalRow[]>();
  for (const goal of (goals ?? []) as GoalRow[]) {
    if (!goal.match_id) continue;
    goalsByMatchId.set(goal.match_id, [...(goalsByMatchId.get(goal.match_id) ?? []), goal]);
  }
  const standings = buildSessionStandings(matchRows);
  const fixtureMatches = matchRows.map((match) => ({
    matchNumber: match.match_number,
    teamAName: match.team_a?.name ?? null,
    teamBName: match.team_b?.name ?? null,
    homeTeamName: homeTeamName(match),
    awayTeamName: awayTeamName(match),
    scheduledStartTime: match.scheduled_start_time,
    scheduledEndTime: match.scheduled_end_time
  }));
  return (
    <AppShell>
      <div className="grid gap-6">
        <section className="panel p-5">
          <h1 className="page-title">{session?.name ?? session?.session_date}</h1>
          <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-600">
            {session?.name ? <span>{session.session_date}</span> : null}
            <span>{(session as any)?.seasons?.name}</span>
            <span>{(session as any)?.playgrounds?.name ?? session?.location ?? "-"}</span>
            <span>{session?.price_per_session == null ? "Season default price" : `${money(session.price_per_session)} session price`}</span>
            {session?.status ? <StatusBadge status={session.status} /> : null}
          </div>
          {isAdmin ? (
            <form action={updateSessionPrice} className="mt-4 flex max-w-sm gap-2">
              <input name="session_id" type="hidden" value={id} />
              <input
                className="input flex-1"
                defaultValue={session?.price_per_session ?? ""}
                name="price_per_session"
                placeholder="Session price override"
                step="0.01"
                type="number"
              />
              <button className="btn-secondary">Update price</button>
            </form>
          ) : null}
          {session?.status !== "completed" ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Link className="btn-secondary" href={`/public/sessions/${id}/teams`}>Build teams</Link>
              {canManageSessionActivity ? <Link className="btn-secondary" href={`/sessions/${id}/fixture`}>Generate fixture</Link> : null}
              {canManageSessionActivity ? <Link className="btn-secondary" href={`/sessions/${id}/scores`}>Game scores</Link> : null}
              <Link className="btn-secondary" href={`/sessions/${id}/lineups`}>Lineups</Link>
              <Link className="btn-secondary" href={`/public/sessions/${id}/summary`}>Session summary</Link>
              {isAdmin ? (
                <form action={completeSession}>
                  <input name="session_id" type="hidden" value={id} />
                  <button className="btn-primary">
                    Mark session completed
                  </button>
                </form>
              ) : null}
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <Link className="btn-secondary" href={`/public/sessions/${id}/teams`}>View team builder</Link>
              {canManageSessionActivity ? <Link className="btn-secondary" href={`/sessions/${id}/fixture`}>View fixture</Link> : null}
              {canManageSessionActivity ? <Link className="btn-secondary" href={`/sessions/${id}/scores`}>Game scores</Link> : null}
              <Link className="btn-secondary" href={`/sessions/${id}/lineups`}>Lineups</Link>
              <Link className="btn-secondary" href={`/public/sessions/${id}/summary`}>Session summary</Link>
            </div>
          )}
        </section>
        <section className="grid gap-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="section-title">Game standings</h2>
              <p className="text-sm text-slate-500">Win = 3 points, draw = 1 point. Away goals break ties after goals scored when an away team is selected.</p>
            </div>
          </div>
          <DataTable rows={standings} columns={[
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
          ]} />
        </section>
        <FixtureScheduleCard matches={fixtureMatches} sessionLabel={session?.name ?? session?.session_date ?? "Session"} />
        <section className="grid gap-3">
          <h2 className="section-title">Game scores</h2>
          <DataTable rows={matchRows} columns={[
            { header: "Game", cell: (row) => row.match_number },
            { header: "Result", cell: (row) => `${row.team_a?.name ?? "-"} ${row.team_a_score}-${row.team_b_score} ${row.team_b?.name ?? "-"}` },
            { header: "Goals/Assists", cell: (row) => <GoalDetails goals={goalsByMatchId.get(row.id) ?? []} /> },
            { header: "Home/Away", cell: (row) => homeAwayLabel(row) }
          ]} />
        </section>
        <section className="grid gap-3">
          <h2 className="section-title">Teams</h2>
          <DataTable rows={teams ?? []} columns={[
            { header: "Team", cell: (row) => row.name },
            { header: "Captain", cell: (row: any) => row.captain?.display_name ?? "-" },
            { header: "Players", cell: (row: any) => (row.session_team_players ?? []).map((item: any) => item.players?.display_name).filter(Boolean).join(", ") || "-" }
          ]} />
        </section>
        <section className="grid gap-3">
          <h2 className="section-title">Goals and assists</h2>
          <DataTable rows={goals ?? []} columns={[
            { header: "Type", cell: (row) => row.goal_type === "own_goal" ? "Own goal" : "Goal" },
            { header: "Scorer", cell: (row: any) => row.scorer?.display_name ?? "-" },
            { header: "Assist", cell: (row: any) => row.assist?.display_name ?? "-" },
            { header: "Team", cell: (row: any) => row.session_teams?.name ?? row.team ?? "-" },
            { header: "Goals", cell: (row) => row.goal_count ?? 1 }
          ]} />
        </section>
        <section className="grid gap-3">
          <h2 className="section-title">Attendance</h2>
          <DataTable rows={attendance ?? []} columns={[
            { header: "Player", cell: (row: any) => row.players?.display_name ?? "-" },
            { header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
            { header: "Charge", cell: (row: any) => chargeSummary(chargeByPlayerId.get(row.player_id), session) },
            { header: "Waiver", cell: (row: any) => waiverSummary(chargeByPlayerId.get(row.player_id)) },
            { header: "Notes", cell: (row) => row.notes ?? "-" }
          ]} />
        </section>
        <section className="grid gap-3">
          <h2 className="section-title">Dropouts and replacements</h2>
          <DataTable rows={dropouts ?? []} columns={[
            { header: "Original", cell: (row: any) => row.original?.display_name ?? "-" },
            { header: "Replacement", cell: (row: any) => row.replacement?.display_name ?? "-" },
            { header: "Transfer type", cell: (row) => row.transfer_type.replaceAll("_", " ") }
          ]} />
        </section>
      </div>
    </AppShell>
  );
}

type MatchRow = {
  id: string;
  match_number: number;
  team_a_id: string;
  team_b_id: string;
  away_team_id?: string | null;
  scheduled_start_time?: string | null;
  scheduled_end_time?: string | null;
  result_status?: string | null;
  team_a_score: number;
  team_b_score: number;
  team_a?: { name?: string | null } | null;
  team_b?: { name?: string | null } | null;
};

type GoalRow = {
  match_id?: string | null;
  goal_count?: number | string | null;
  scorer?: { display_name?: string | null } | null;
  assist?: { display_name?: string | null } | null;
};

function GoalDetails({ goals }: { goals: GoalRow[] }) {
  const details = goals.flatMap((goal) => {
    const parsedCount = Number(goal.goal_count ?? 1);
    const count = Number.isFinite(parsedCount) ? Math.max(1, Math.floor(parsedCount)) : 1;
    const scorer = goal.scorer?.display_name ?? "-";
    const assist = goal.assist?.display_name;
    const label = `Scorer: ${scorer}${assist ? ` | Assist: ${assist}` : ""}`;
    return Array.from({ length: count }, () => label);
  });

  if (!details.length) return "-";

  return (
    <div className="grid gap-1">
      {details.map((detail, index) => <div key={`${detail}-${index}`}>{detail}</div>)}
    </div>
  );
}

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
    const teamA = ensure(match.team_a_id, match.team_a?.name ?? "Team A");
    const teamB = ensure(match.team_b_id, match.team_b?.name ?? "Team B");
    if (match.result_status !== "played") continue;
    applyResult(teamA, Number(match.team_a_score ?? 0), Number(match.team_b_score ?? 0), match.away_team_id === match.team_a_id);
    applyResult(teamB, Number(match.team_b_score ?? 0), Number(match.team_a_score ?? 0), match.away_team_id === match.team_b_id);
  }

  const standings = Array.from(rows.values()).map((row) => ({
    ...row,
    goalDifference: row.goalsFor - row.goalsAgainst,
    headToHead: headToHeadSummary(row.teamId, matches)
  }));

  return standings
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

function headToHeadSummary(teamId: string, matches: MatchRow[]) {
  const parts = matches
    .filter((match) => match.result_status === "played" && (match.team_a_id === teamId || match.team_b_id === teamId))
    .map((match) => {
      const isA = match.team_a_id === teamId;
      const opponent = isA ? match.team_b?.name : match.team_a?.name;
      const gf = isA ? match.team_a_score : match.team_b_score;
      const ga = isA ? match.team_b_score : match.team_a_score;
      return `${opponent ?? "Opponent"} ${gf}-${ga}`;
    });
  return parts.join(", ");
}

function homeAwayLabel(match: MatchRow) {
  const home = homeTeamName(match);
  const away = awayTeamName(match);
  if (home && away) return `${home} home, ${away} away`;
  return "-";
}

function homeTeamName(match: MatchRow) {
  if (match.away_team_id === match.team_a_id) return match.team_b?.name ?? "Team B";
  if (match.away_team_id === match.team_b_id) return match.team_a?.name ?? "Team A";
  return null;
}

function awayTeamName(match: MatchRow) {
  if (match.away_team_id === match.team_a_id) return match.team_a?.name ?? "Team A";
  if (match.away_team_id === match.team_b_id) return match.team_b?.name ?? "Team B";
  return null;
}

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function chargeSummary(charge: any, session: any) {
  const originalAmount = Number(charge?.original_amount ?? charge?.amount ?? session?.price_per_session ?? session?.seasons?.price_per_session ?? 0);
  const netAmount = Number(charge?.amount ?? originalAmount);
  if (!charge) return `${money(originalAmount)} pending`;
  if (Number(charge.waiver_amount ?? 0) > 0) return `${money(netAmount)} of ${money(originalAmount)}`;
  return money(netAmount);
}

function waiverSummary(charge: any) {
  const waiverAmount = Number(charge?.waiver_amount ?? 0);
  if (!charge || waiverAmount <= 0) return "-";
  const reason = charge.waiver_reason ? ` - ${charge.waiver_reason}` : "";
  return `${money(waiverAmount)} waived${reason}`;
}
