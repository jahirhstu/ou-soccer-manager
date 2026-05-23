"use server";

import { revalidatePath } from "next/cache";
import { hasPermission } from "../permissions";
import { createSupabaseServerClient, getCurrentProfile } from "../supabase/server";

type MiniGameGoalInput = {
  scorerId?: string;
  assistPlayerId?: string;
  sessionTeamId?: string;
  goalCount?: number;
};

type MiniGameInput = {
  matchNumber: number;
  teamAId: string;
  teamBId: string;
  teamAScore: number;
  teamBScore: number;
  goals?: MiniGameGoalInput[];
};

export async function saveMiniGameScores(_: unknown, formData: FormData) {
  try {
    const profile = await getCurrentProfile();
    if (!hasPermission(profile?.role, "manage_attendance")) return { error: "Only captains and admins can save mini-game scores." };

    const sessionId = String(formData.get("sessionId") ?? "");
    const games = JSON.parse(String(formData.get("gamesJson") ?? "[]")) as MiniGameInput[];
    if (!sessionId) return { error: "Session is missing." };
    if (!Array.isArray(games)) return { error: "Mini-game data is invalid." };

    const supabase = await createSupabaseServerClient();
    const seenMatchNumbers = new Set<number>();
    const requestedMatchNumbers = games
      .map((game) => Number(game.matchNumber))
      .filter((matchNumber) => Number.isFinite(matchNumber) && matchNumber > 0);

    const { data: existingMatches, error: existingError } = await supabase
      .from("session_matches")
      .select("id,match_number")
      .eq("session_id", sessionId);
    if (existingError) throw new Error(existingError.message);

    const removedMatchIds = (existingMatches ?? [])
      .filter((match) => !requestedMatchNumbers.includes(Number(match.match_number)))
      .map((match) => match.id);
    if (removedMatchIds.length) {
      const { error: deleteGoalError } = await supabase.from("goals").delete().in("match_id", removedMatchIds);
      if (deleteGoalError) throw new Error(deleteGoalError.message);
      const { error: deleteMatchError } = await supabase.from("session_matches").delete().in("id", removedMatchIds);
      if (deleteMatchError) throw new Error(deleteMatchError.message);
    }

    for (const game of games) {
      const matchNumber = Number(game.matchNumber);
      const teamAScore = Number(game.teamAScore);
      const teamBScore = Number(game.teamBScore);
      if (!Number.isFinite(matchNumber) || matchNumber <= 0) continue;
      if (!game.teamAId || !game.teamBId || game.teamAId === game.teamBId) continue;
      if (!Number.isFinite(teamAScore) || !Number.isFinite(teamBScore)) continue;
      if (seenMatchNumbers.has(matchNumber)) continue;
      seenMatchNumbers.add(matchNumber);

      const { data: match, error } = await supabase
        .from("session_matches")
        .upsert(
          {
            session_id: sessionId,
            match_number: matchNumber,
            team_a_id: game.teamAId,
            team_b_id: game.teamBId,
            team_a_score: teamAScore,
            team_b_score: teamBScore,
            created_by: profile.id
          },
          { onConflict: "session_id,match_number" }
        )
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      const { error: deleteError } = await supabase.from("goals").delete().eq("session_id", sessionId).eq("match_id", match.id);
      if (deleteError) throw new Error(deleteError.message);

      const goalRows = (game.goals ?? [])
        .map((goal) => ({
          session_id: sessionId,
          match_id: match.id,
          scorer_id: goal.scorerId,
          assist_player_id: goal.assistPlayerId || null,
          session_team_id: goal.sessionTeamId || null,
          goal_count: Math.max(1, Number(goal.goalCount ?? 1) || 1),
          created_by: profile.id
        }))
        .filter((goal) => goal.scorer_id);
      if (goalRows.length) {
        const { error: goalError } = await supabase.from("goals").insert(goalRows);
        if (goalError) throw new Error(goalError.message);
      }
    }

    revalidatePath(`/sessions/${sessionId}`);
    revalidatePath(`/sessions/${sessionId}/scores`);
    revalidatePath("/reports/leaderboards");
    revalidatePath("/reports/stats");
    revalidatePath("/public/report");
    return { success: true, message: "Mini-game scores saved." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save mini-game scores." };
  }
}

export async function saveTeamLineup(_: unknown, formData: FormData) {
  try {
    const profile = await getCurrentProfile();
    if (!hasPermission(profile?.role, "manage_attendance")) return { error: "Only captains and admins can save lineups." };

    const sessionId = String(formData.get("sessionId") ?? "");
    const sessionTeamId = String(formData.get("sessionTeamId") ?? "");
    const playerCount = Math.max(1, Number(formData.get("playerCount") ?? 0) || 0);
    const formation = String(formData.get("formation") ?? "");
    const positions = JSON.parse(String(formData.get("positionsJson") ?? "[]"));
    if (!sessionId || !sessionTeamId) return { error: "Session and team are required." };
    if (!Array.isArray(positions)) return { error: "Lineup positions are invalid." };

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("session_team_lineups").upsert(
      {
        session_id: sessionId,
        session_team_id: sessionTeamId,
        player_count: playerCount,
        formation,
        positions,
        created_by: profile.id
      },
      { onConflict: "session_team_id" }
    );
    if (error) throw new Error(error.message);

    revalidatePath(`/sessions/${sessionId}`);
    revalidatePath(`/sessions/${sessionId}/lineups`);
    return { success: true, message: "Lineup saved." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save lineup." };
  }
}
