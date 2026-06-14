"use server";

import { revalidatePath } from "next/cache";
import { hasPermission } from "../permissions";
import { createSupabaseServerClient, getCurrentProfile } from "../supabase/server";

function percentValue(value: FormDataEntryValue | null) {
  if (value == null || value === "") return null;
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 0 || numberValue > 100) {
    throw new Error("Skill ratings must be whole numbers from 0 to 100.");
  }
  return numberValue;
}

export async function savePlayerPerformanceRatings(_: unknown, formData: FormData) {
  try {
    const profile = await getCurrentProfile();
    if (!hasPermission(profile?.role, "manage_attendance")) throw new Error("Only admins and captains can update player performance.");
    if (!profile?.organization_id) throw new Error("No organization found for this account.");

    const programId = String(formData.get("program_id") ?? "");
    if (!programId) throw new Error("Choose a program before saving ratings.");

    const supabase = await createSupabaseServerClient();
    const { data: program, error: programError } = await supabase
      .from("programs")
      .select("id,organization_id")
      .eq("id", programId)
      .maybeSingle();
    if (programError) throw new Error(programError.message);
    if (!program || program.organization_id !== profile.organization_id) throw new Error("Program not found for this organization.");

    const playerIds = Array.from(new Set(
      Array.from(formData.keys())
        .filter((key) => key.startsWith("attack_"))
        .map((key) => key.replace("attack_", ""))
        .filter(Boolean)
    ));

    for (const playerId of playerIds) {
      const attacking = percentValue(formData.get(`attack_${playerId}`));
      const defending = percentValue(formData.get(`defense_${playerId}`));
      const goalkeeping = percentValue(formData.get(`goalkeeping_${playerId}`));
      const notesKey = `notes_${playerId}`;
      const hasNotesInput = formData.has(notesKey);
      const notes = hasNotesInput ? String(formData.get(notesKey) ?? "").trim() || null : null;

      if (attacking == null && defending == null && goalkeeping == null && (!hasNotesInput || notes == null)) {
        const { error } = await supabase
          .from("player_performance_ratings")
          .delete()
          .eq("program_id", programId)
          .eq("player_id", playerId)
          .eq("organization_id", profile.organization_id);
        if (error) throw new Error(error.message);
        continue;
      }

      const ratingRow = {
        attacking_skill_percent: attacking,
        defending_skill_percent: defending,
        goalkeeping_skill_percent: goalkeeping,
        organization_id: profile.organization_id,
        player_id: playerId,
        program_id: programId,
        updated_by: profile.id,
        created_by: profile.id,
        ...(hasNotesInput ? { notes } : {})
      };

      const { error } = await supabase
        .from("player_performance_ratings")
        .upsert(ratingRow, { onConflict: "program_id,player_id" });
      if (error) throw new Error(error.message);
    }

    revalidatePath("/performance");
    revalidatePath("/sessions");
    revalidatePath("/public/sessions");
    return { success: true, message: "Player ratings saved." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save player ratings." };
  }
}
