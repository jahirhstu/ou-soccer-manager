import { MiniGameScoresForm, type MatchInput } from "@/components/MiniGameScoresForm";
import { PublicShell } from "@/components/PublicShell";
import { saveMiniGameScores, savePublicGameScores } from "@/lib/actions/session-management";
import { hasPermission, isSessionScoreReadOnly } from "@/lib/permissions";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import Link from "next/link";

type PublicScoreData = {
  session?: {
    id: string;
    name: string | null;
    sessionDate: string;
    startTime?: string | null;
    endTime?: string | null;
    status?: string | null;
  } | null;
  teams?: Array<{
    id: string;
    name: string;
    players: Array<{ id: string; name: string }>;
  }>;
  matches?: Array<{
    id: string;
    matchNumber: number;
    displayOrder?: number | null;
    teamAId: string;
    teamBId: string;
    awayTeamId?: string | null;
    resultStatus?: "scheduled" | "played" | null;
    scheduledStartTime?: string | null;
    scheduledEndTime?: string | null;
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
  const isAdmin = profile?.role === "admin";
  const canManageSessionActivity = hasPermission(profile?.role, "manage_attendance");
  const scoreData = (data ?? {}) as PublicScoreData;
  const teamOptions = scoreData.teams ?? [];
  const readOnly = isSessionScoreReadOnly(profile?.role, scoreData.session ?? null, currentTorontoDate());
  const existingGames: MatchInput[] = [...(scoreData.matches ?? [])]
    .sort((left, right) => Number(left.matchNumber) - Number(right.matchNumber))
    .map((match) => ({
      key: match.id,
      matchNumber: match.matchNumber,
      displayOrder: match.displayOrder ?? undefined,
      teamAId: match.teamAId,
      teamBId: match.teamBId,
      awayTeamId: match.awayTeamId ?? "",
      resultStatus: match.resultStatus === "played" ? "played" : "scheduled",
      scheduledStartTime: match.scheduledStartTime ?? "",
      scheduledEndTime: match.scheduledEndTime ?? "",
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
        ) : !existingGames.length ? (
          <div className="panel border-dashed p-10 text-center text-sm text-slate-500">
            Generate a fixture before entering game scores.
            {canManageSessionActivity ? <div className="mt-3"><Link className="btn-secondary" href={`/sessions/${id}/fixture`}>Generate fixture</Link></div> : null}
          </div>
        ) : (
          <MiniGameScoresForm
            existingGames={existingGames}
            heading="Game scores"
            readOnly={readOnly}
            readOnlyReason="Scores are read-only because this session is completed or past its date."
            saveAction={isAdmin ? saveMiniGameScores : savePublicGameScores}
            sessionId={id}
            sessionLabel={scoreData.session?.name ?? scoreData.session?.sessionDate ?? "Session"}
            teams={teamOptions}
          />
        )}
      </div>
    </PublicShell>
  );
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
