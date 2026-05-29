import { MiniGameScoresForm, type MatchInput } from "@/components/MiniGameScoresForm";
import { PublicShell } from "@/components/PublicShell";
import { savePublicGameScores } from "@/lib/actions/session-management";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";

type PublicScoreData = {
  session?: {
    id: string;
    name: string | null;
    sessionDate: string;
  } | null;
  teams?: Array<{
    id: string;
    name: string;
    players: Array<{ id: string; name: string }>;
  }>;
  matches?: Array<{
    id: string;
    matchNumber: number;
    teamAId: string;
    teamBId: string;
    awayTeamId?: string | null;
    goals: Array<{
      id: string;
      scorerId: string;
      assistPlayerId: string | null;
      goalType: "goal" | "own_goal";
      goalCount: number;
    }>;
  }>;
};

export default async function PublicGameScoresPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [{ data, error }, profile] = await Promise.all([
    supabase.rpc("public_game_score_editor", { p_session_id: id }),
    getCurrentProfile()
  ]);
  const showReturnLink = hasPermission(profile?.role, "manage_attendance");
  const scoreData = (data ?? {}) as PublicScoreData;
  const teamOptions = scoreData.teams ?? [];
  const existingGames: MatchInput[] = (scoreData.matches ?? []).map((match) => ({
    key: match.id,
    matchNumber: match.matchNumber,
    teamAId: match.teamAId,
    teamBId: match.teamBId,
    awayTeamId: match.awayTeamId ?? "",
    goals: (match.goals ?? []).map((goal) => ({
      key: goal.id,
      scorerId: goal.scorerId,
      assistPlayerId: goal.assistPlayerId ?? "",
      goalType: goal.goalType === "own_goal" ? "own_goal" : "goal",
      goalCount: goal.goalCount ?? 1
    }))
  }));

  return (
    <PublicShell returnHref={showReturnLink ? "/dashboard" : undefined} returnLabel="Return">
      <div className="grid gap-5">
        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            Public game scores are not ready yet. Run the latest database migration, then refresh this page.
          </div>
        ) : teamOptions.length < 2 ? (
          <div className="panel border-dashed p-10 text-center text-sm text-slate-500">Create at least two teams before entering game scores.</div>
        ) : (
          <MiniGameScoresForm
            existingGames={existingGames}
            heading="Game scores"
            saveAction={savePublicGameScores}
            sessionId={id}
            sessionLabel={scoreData.session?.name ?? scoreData.session?.sessionDate ?? "Session"}
            teams={teamOptions}
          />
        )}
      </div>
    </PublicShell>
  );
}
