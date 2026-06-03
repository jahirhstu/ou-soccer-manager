import { MiniGameScoresForm, type MatchInput } from "@/components/MiniGameScoresForm";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { AppShell } from "../../../(shell)";

export default async function MiniGameScoresPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const profile = await getCurrentProfile();
  const canEdit = hasPermission(profile?.role, "manage_attendance");
  const [{ data: session }, { data: teams }, { data: matches }, { data: goals }] = await Promise.all([
    supabase.from("sessions").select("id,name,session_date,status").eq("id", id).single(),
    supabase
      .from("session_teams")
      .select("id,name,session_team_players(players(id,display_name))")
      .eq("session_id", id)
      .order("name"),
    supabase
      .from("session_matches")
      .select("*")
      .eq("session_id", id)
      .order("match_number"),
    supabase
      .from("goals")
      .select("id,match_id,scorer_id,assist_player_id,goal_type,goal_count")
      .eq("session_id", id)
      .not("match_id", "is", null)
  ]);
  const readOnly = isLockedSession(session);
  const teamOptions = (teams ?? []).map((team: any) => ({
    id: team.id,
    name: team.name,
    players: (team.session_team_players ?? [])
      .map((row: any) => row.players ? { id: row.players.id, name: row.players.display_name } : null)
      .filter((player: { id: string; name: string } | null): player is { id: string; name: string } => Boolean(player))
  }));
  const goalsByMatch = new Map<string, any[]>();
  for (const goal of goals ?? []) {
    goalsByMatch.set(goal.match_id, [...(goalsByMatch.get(goal.match_id) ?? []), goal]);
  }
  const existingGames: MatchInput[] = (matches ?? []).map((match: any) => ({
    key: match.id,
    matchNumber: match.match_number,
    displayOrder: match.display_order ?? undefined,
    teamAId: match.team_a_id,
    teamBId: match.team_b_id,
    awayTeamId: match.away_team_id ?? "",
    goals: (goalsByMatch.get(match.id) ?? []).map((goal) => ({
      key: goal.id,
      scorerId: goal.scorer_id,
      assistPlayerId: goal.assist_player_id ?? "",
      goalType: goal.goal_type === "own_goal" ? "own_goal" as const : "goal" as const,
      goalCount: goal.goal_count ?? 1
    }))
  }));

  return (
    <AppShell>
      <div className="grid gap-5">
        {!canEdit ? (
          <div className="panel border-dashed p-10 text-center text-sm text-slate-500">Only captains and admins can edit game scores.</div>
        ) : teamOptions.length < 2 ? (
          <div className="panel border-dashed p-10 text-center text-sm text-slate-500">Create at least two teams before entering game scores.</div>
        ) : (
          <MiniGameScoresForm
            existingGames={existingGames}
            heading="Game scores"
            readOnly={readOnly}
            readOnlyReason="Scores are read-only because this session is completed or past its date."
            sessionId={id}
            sessionLabel={session?.name ?? session?.session_date ?? "Session"}
            teams={teamOptions}
          />
        )}
      </div>
    </AppShell>
  );
}

function isLockedSession(session: { session_date?: string | null; status?: string | null } | null) {
  if (!session) return false;
  return session.status === "completed" || String(session.session_date ?? "") < currentTorontoDate();
}

function currentTorontoDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Toronto",
    year: "numeric"
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}
