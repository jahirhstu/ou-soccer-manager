"use server";

import { revalidatePath } from "next/cache";
import { hasPermission } from "../permissions";
import { createSupabaseServerClient, getCurrentProfile } from "../supabase/server";

type TeamBuilderDraftPayload = {
  sessionId: string;
  teams: unknown[];
  playersPerTeam: number;
  draftMode: "lottery" | "balanced";
  pickCursor: number;
  tossOrderKeys: string[] | null;
  rouletteRotation: number;
};

export async function saveSessionTeamBuilder(_: unknown, formData: FormData) {
  try {
    const profile = await getCurrentProfile();
    if (!hasPermission(profile?.role, "manage_attendance")) {
      return { error: "Only captains and admins can save teams." };
    }

    const sessionId = String(formData.get("sessionId") ?? "");
    const playersPerTeam = Math.max(1, Number(formData.get("playersPerTeam") ?? 0) || 8);
    const teamsJson = String(formData.get("teamsJson") ?? "[]");
    const teams = JSON.parse(teamsJson);

    if (!sessionId) return { error: "Session is missing." };
    if (!Array.isArray(teams)) return { error: "Team data is invalid." };

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("save_program_team_builder", {
      p_players_per_team: playersPerTeam,
      p_session_id: sessionId,
      p_teams: teams
    });
    if (error) throw new Error(error.message);

    revalidatePath(`/public/sessions/${sessionId}/teams`);
    revalidatePath(`/public/sessions/${sessionId}`);
    revalidatePath(`/public/sessions/${sessionId}/scores`);
    revalidatePath(`/sessions/${sessionId}`);
    revalidatePath(`/sessions/${sessionId}/scores`);
    revalidatePath("/public/report");
    revalidatePath("/public/leaderboards");
    revalidatePath("/reports/leaderboards");
    return { success: true, message: "Teams saved successfully." };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message || "Could not save teams." };
  }
}

export async function autosaveSessionTeamBuilderDraft(payload: TeamBuilderDraftPayload) {
  try {
    const profile = await getCurrentProfile();
    if (!hasPermission(profile?.role, "manage_attendance")) {
      return { error: "Only captains and admins can autosave team drafts." };
    }

    const sessionId = String(payload.sessionId ?? "");
    const teams = Array.isArray(payload.teams) ? payload.teams : [];
    const playersPerTeam = Math.max(1, Number(payload.playersPerTeam ?? 0) || 8);
    const draftMode = payload.draftMode === "balanced" ? "balanced" : "lottery";
    const pickCursor = Math.max(0, Number(payload.pickCursor ?? 0) || 0);
    const tossOrderKeys = Array.isArray(payload.tossOrderKeys) ? payload.tossOrderKeys : null;
    const rouletteRotation = Number(payload.rouletteRotation ?? 0) || 0;

    if (!sessionId) return { error: "Session is missing." };

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("save_program_team_builder_draft", {
      p_draft_mode: draftMode,
      p_pick_cursor: pickCursor,
      p_players_per_team: playersPerTeam,
      p_roulette_rotation: rouletteRotation,
      p_session_id: sessionId,
      p_teams: teams,
      p_toss_order_keys: tossOrderKeys
    });
    if (error) throw new Error(error.message);

    const updatedAt = data && typeof data === "object" && "updatedAt" in data ? String(data.updatedAt) : undefined;
    return { success: true, updatedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message || "Could not autosave team draft." };
  }
}
