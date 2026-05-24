import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { completeSession, updateSessionPrice } from "@/lib/actions/crud";
import { money } from "@/lib/utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "../../(shell)";
import Link from "next/link";

export default async function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [{ data: session }, { data: attendance }, { data: dropouts }, { data: goals }, { data: teams }, { data: matches }] = await Promise.all([
    supabase.from("sessions").select("*,seasons(name),playgrounds(name)").eq("id", id).single(),
    supabase.from("attendance").select("*,players(display_name)").eq("session_id", id),
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
      .order("match_number")
  ]);
  const matchRows = (matches ?? []) as MatchRow[];
  const standings = buildSessionStandings(matchRows);
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
          {session?.status !== "completed" ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Link className="btn-secondary" href={`/public/sessions/${id}/teams`}>Build teams</Link>
              <Link className="btn-secondary" href={`/sessions/${id}/teams/edit`}>Edit team players</Link>
              <Link className="btn-secondary" href={`/sessions/${id}/scores`}>Mini-game scores</Link>
              <Link className="btn-secondary" href={`/sessions/${id}/lineups`}>Lineups</Link>
              <form action={completeSession}>
                <input name="session_id" type="hidden" value={id} />
                <button className="btn-primary">
                  Mark session completed
                </button>
              </form>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <Link className="btn-secondary" href={`/public/sessions/${id}/teams`}>View team builder</Link>
              <Link className="btn-secondary" href={`/sessions/${id}/teams/edit`}>Edit team players</Link>
              <Link className="btn-secondary" href={`/sessions/${id}/scores`}>Mini-game scores</Link>
              <Link className="btn-secondary" href={`/sessions/${id}/lineups`}>Lineups</Link>
            </div>
          )}
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
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="section-title">Mini-game standings</h2>
              <p className="text-sm text-slate-500">Win = 3 points, draw = 1 point. Head-to-head is shown for quick tie checks.</p>
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
            { header: "Pts", cell: (row) => <span className="font-semibold text-ink">{row.points}</span> },
            { header: "Head-to-head", cell: (row) => row.headToHead || "-" }
          ]} />
        </section>
        <section className="grid gap-3">
          <h2 className="section-title">Mini games</h2>
          <DataTable rows={matchRows} columns={[
            { header: "Game", cell: (row) => row.match_number },
            { header: "Result", cell: (row) => `${row.team_a?.name ?? "-"} ${row.team_a_score}-${row.team_b_score} ${row.team_b?.name ?? "-"}` }
          ]} />
        </section>
        <section className="grid gap-3">
          <h2 className="section-title">Attendance</h2>
          <DataTable rows={attendance ?? []} columns={[
            { header: "Player", cell: (row: any) => row.players?.display_name ?? "-" },
            { header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
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
      </div>
    </AppShell>
  );
}

type MatchRow = {
  match_number: number;
  team_a_id: string;
  team_b_id: string;
  team_a_score: number;
  team_b_score: number;
  team_a?: { name?: string | null } | null;
  team_b?: { name?: string | null } | null;
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
    const teamA = ensure(match.team_a_id, match.team_a?.name ?? "Team A");
    const teamB = ensure(match.team_b_id, match.team_b?.name ?? "Team B");
    applyResult(teamA, Number(match.team_a_score ?? 0), Number(match.team_b_score ?? 0));
    applyResult(teamB, Number(match.team_b_score ?? 0), Number(match.team_a_score ?? 0));
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
  const parts = matches
    .filter((match) => match.team_a_id === teamId || match.team_b_id === teamId)
    .map((match) => {
      const isA = match.team_a_id === teamId;
      const opponent = isA ? match.team_b?.name : match.team_a?.name;
      const gf = isA ? match.team_a_score : match.team_b_score;
      const ga = isA ? match.team_b_score : match.team_a_score;
      return `${opponent ?? "Opponent"} ${gf}-${ga}`;
    });
  return parts.join(", ");
}

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}
