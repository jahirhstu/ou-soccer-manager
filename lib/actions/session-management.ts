"use server";

import { revalidatePath } from "next/cache";
import { hasPermission } from "../permissions";
import { createSupabaseServerClient, getCurrentProfile } from "../supabase/server";

type MiniGameGoalInput = {
  scorerId?: string;
  assistPlayerId?: string;
  goalCount?: number;
  goalType?: "goal" | "own_goal";
};

type MiniGameInput = {
  matchNumber: number;
  teamAId: string;
  teamBId: string;
  awayTeamId?: string;
  goals?: MiniGameGoalInput[];
};

export async function saveMiniGameScores(_: unknown, formData: FormData) {
  try {
    const profile = await getCurrentProfile();
    if (!hasPermission(profile?.role, "manage_attendance")) return { error: "Only captains and admins can save game scores." };

    const sessionId = String(formData.get("sessionId") ?? "");
    const games = JSON.parse(String(formData.get("gamesJson") ?? "[]")) as MiniGameInput[];
    if (!sessionId) return { error: "Session is missing." };
    if (!Array.isArray(games)) return { error: "Game score data is invalid." };

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

    const { data: teamPlayers, error: teamPlayersError } = await supabase
      .from("session_team_players")
      .select("session_team_id,player_id")
      .eq("session_id", sessionId);
    if (teamPlayersError) throw new Error(teamPlayersError.message);

    const playerTeamIds = new Map((teamPlayers ?? []).map((row) => [String(row.player_id), String(row.session_team_id)]));
    let savedGames = 0;

    const { error: orphanGoalError } = await supabase
      .from("goals")
      .delete()
      .eq("session_id", sessionId)
      .is("match_id", null)
      .is("session_team_id", null);
    if (orphanGoalError) throw new Error(orphanGoalError.message);

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
      if (!Number.isFinite(matchNumber) || matchNumber <= 0) continue;
      if (!game.teamAId || !game.teamBId || game.teamAId === game.teamBId) continue;
      if (seenMatchNumbers.has(matchNumber)) continue;
      seenMatchNumbers.add(matchNumber);
      const awayTeamId = game.awayTeamId === game.teamAId || game.awayTeamId === game.teamBId ? game.awayTeamId : null;

      const normalizedGoals = normalizeMiniGameGoals(game, playerTeamIds);
      const teamAScore = normalizedGoals
        .filter((goal) => goal.session_team_id === game.teamAId)
        .reduce((total, goal) => total + goal.goal_count, 0);
      const teamBScore = normalizedGoals
        .filter((goal) => goal.session_team_id === game.teamBId)
        .reduce((total, goal) => total + goal.goal_count, 0);

      const { data: match, error } = await supabase
        .from("session_matches")
        .upsert(
          {
            session_id: sessionId,
            match_number: matchNumber,
            team_a_id: game.teamAId,
            team_b_id: game.teamBId,
            away_team_id: awayTeamId,
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

      const goalRows = normalizedGoals
        .map((goal) => ({
          session_id: sessionId,
          match_id: match.id,
          scorer_id: goal.scorerId,
          assist_player_id: goal.assist_player_id,
          session_team_id: goal.session_team_id,
          goal_type: goal.goal_type,
          goal_count: goal.goal_count,
          notes: goal.goal_type === "own_goal" ? "Own goal" : null,
          created_by: profile.id
        }));
      if (goalRows.length) {
        const { error: goalError } = await supabase.from("goals").insert(goalRows);
        if (goalError) throw new Error(goalError.message);
      }
      savedGames += 1;
    }

    if (!savedGames) return { error: "No valid games were saved. Select two different teams for at least one game." };

    revalidatePath(`/sessions/${sessionId}`);
    revalidatePath(`/sessions/${sessionId}/scores`);
    revalidatePath("/reports/leaderboards");
    revalidatePath("/public/leaderboards");
    revalidatePath("/reports/stats");
    revalidatePath("/public/report");
    return { success: true, message: "Game scores saved." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save game scores." };
  }
}

export async function savePublicGameScores(_: unknown, formData: FormData) {
  try {
    const sessionId = String(formData.get("sessionId") ?? "");
    const games = JSON.parse(String(formData.get("gamesJson") ?? "[]")) as MiniGameInput[];
    if (!sessionId) return { error: "Session is missing." };
    if (!Array.isArray(games)) return { error: "Game score data is invalid." };

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("public_save_game_scores", {
      p_games: games,
      p_session_id: sessionId
    });
    if (error) throw new Error(error.message);
    if (data && typeof data === "object" && "error" in data) return { error: String(data.error) };

    revalidatePath(`/public/sessions/${sessionId}`);
    revalidatePath(`/public/sessions/${sessionId}/scores`);
    revalidatePath(`/sessions/${sessionId}`);
    revalidatePath(`/sessions/${sessionId}/scores`);
    revalidatePath("/public/report");
    revalidatePath("/public/leaderboards");
    revalidatePath("/reports/leaderboards");
    return { success: true, message: "Game scores saved." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save game scores." };
  }
}

function normalizeMiniGameGoals(game: MiniGameInput, playerTeamIds: Map<string, string>) {
  return (game.goals ?? [])
    .map((goal) => {
      const scorerId = String(goal.scorerId ?? "");
      const goalType = goal.goalType === "own_goal" ? "own_goal" : "goal";
      const scorerTeamId = playerTeamIds.get(scorerId);
      const sessionTeamId = goalType === "own_goal"
        ? scorerTeamId === game.teamAId
          ? game.teamBId
          : scorerTeamId === game.teamBId
            ? game.teamAId
            : ""
        : scorerTeamId === game.teamAId || scorerTeamId === game.teamBId
          ? scorerTeamId
          : "";
      const assistPlayerId = goalType === "own_goal" ? "" : String(goal.assistPlayerId ?? "");
      const assistTeamId = assistPlayerId ? playerTeamIds.get(assistPlayerId) : undefined;
      return {
        scorerId,
        assist_player_id: assistTeamId === scorerTeamId ? assistPlayerId : null,
        session_team_id: sessionTeamId || null,
        goal_type: goalType,
        goal_count: Math.max(1, Number(goal.goalCount ?? 1) || 1)
      };
    })
    .filter((goal) => goal.scorerId && goal.session_team_id);
}

export async function saveTeamLineup(_: unknown, formData: FormData) {
  try {
    const profile = await getCurrentProfile();
    if (!profile?.player_id) return { error: "Your account must be linked to a player profile before you can save a lineup." };

    const sessionId = String(formData.get("sessionId") ?? "");
    const sessionTeamId = String(formData.get("sessionTeamId") ?? "");
    const playerCount = Math.max(1, Number(formData.get("playerCount") ?? 0) || 0);
    const formation = String(formData.get("formation") ?? "");
    const positions = JSON.parse(String(formData.get("positionsJson") ?? "[]"));
    if (!sessionId || !sessionTeamId) return { error: "Session and team are required." };
    if (!Array.isArray(positions)) return { error: "Lineup positions are invalid." };

    const supabase = await createSupabaseServerClient();
    const { data: teamPlayer, error: teamPlayerError } = await supabase
      .from("session_team_players")
      .select("id")
      .eq("session_id", sessionId)
      .eq("session_team_id", sessionTeamId)
      .eq("player_id", profile.player_id)
      .maybeSingle();
    if (teamPlayerError) throw new Error(teamPlayerError.message);
    if (!teamPlayer) return { error: "Only players assigned to this team can save its lineup." };

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

export async function linkCaptainPlayerProfile(_: unknown, formData: FormData) {
  try {
    const profile = await getCurrentProfile();
    if (profile?.role !== "captain") return { error: "Only captain accounts can link a player profile here." };
    if (profile.player_id) return { error: "This captain account is already linked to a player profile." };

    const playerId = String(formData.get("playerId") ?? "");
    const sessionId = String(formData.get("sessionId") ?? "");
    if (!playerId) return { error: "Choose the player profile that belongs to you." };

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("link_current_captain_player_profile", { p_player_id: playerId });
    if (error) throw new Error(error.message);

    if (sessionId) revalidatePath(`/sessions/${sessionId}/lineups`);
    return { success: true, message: "Captain profile linked. You can now manage your team lineup." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not link captain profile." };
  }
}
