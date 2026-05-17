"use server";

import { revalidatePath } from "next/cache";
import { hasPermission } from "../permissions";
import { createSupabaseServerClient, getCurrentProfile } from "../supabase/server";

export async function saveSessionTeamBuilder(_: unknown, formData: FormData) {
  try {
    const profile = await getCurrentProfile();
    if (!hasPermission(profile?.role, "manage_attendance")) {
      return { error: "Only captains and admins can save teams." };
    }

    const sessionId = String(formData.get("sessionId") ?? "");
    const teamsJson = String(formData.get("teamsJson") ?? "[]");
    const teams = JSON.parse(teamsJson);

    if (!sessionId) return { error: "Session is missing." };
    if (!Array.isArray(teams)) return { error: "Team data is invalid." };

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("save_session_team_builder", {
      p_session_id: sessionId,
      p_teams: teams
    });
    if (error) throw new Error(error.message);

    revalidatePath(`/public/sessions/${sessionId}/teams`);
    revalidatePath(`/sessions/${sessionId}`);
    return { success: true, message: "Teams saved successfully." };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message || "Could not save teams." };
  }
}
