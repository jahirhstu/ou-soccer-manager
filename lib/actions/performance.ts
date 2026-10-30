"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../supabase/server";

export async function updatePerformance(sessionId: string, operation: "positions" | "vote" | "close", payload: Record<string, unknown>) {
  const db = await createSupabaseServerClient();
  const requests = {
    positions: { name: "confirm_match_positions", args: { p_match_id: payload.matchId, p_players: payload.players } },
    vote: { name: "nominate_session_player", args: { p_session_id: sessionId, p_team_id: payload.teamId, p_category: payload.category, p_player_id: payload.playerId } },
    close: { name: "close_performance_voting", args: { p_session_id: sessionId, p_closed: payload.closed } }
  };
  const request = requests[operation];
  if (!request) return { error: "Unknown operation" };
  const { error } = await db.rpc(request.name, request.args);
  if (error) return { error: error.message };
  revalidatePath(`/sessions/${sessionId}/performance`);
  revalidatePath(`/sessions/${sessionId}/scores`);
  revalidatePath("/dashboard");
  return { success: true };
}
