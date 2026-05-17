"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasPermission } from "../permissions";
import { createSupabaseServerClient, getCurrentProfile } from "../supabase/server";

const cleanupTables = [
  "whatsapp_imports",
  "goals",
  "session_team_players",
  "session_teams",
  "session_player_charges",
  "ledger_entries",
  "dropouts",
  "attendance",
  "payments",
  "sessions",
  "seasons",
  "players"
] as const;

export async function cleanupClubData(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!hasPermission(profile?.role, "manage_all")) throw new Error("Unauthorized");

  const confirmation = String(formData.get("confirmation") ?? "").trim();
  if (confirmation !== "CLEANUP") {
    redirect("/settings?cleanup=confirmation-required");
  }

  const supabase = await createSupabaseServerClient();

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ player_id: null })
    .not("player_id", "is", null);
  if (profileError) throw new Error(profileError.message);

  for (const table of cleanupTables) {
    const { error } = await supabase.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) throw new Error(`Could not clean ${table}: ${error.message}`);
  }

  revalidatePath("/");
  redirect("/settings?cleanup=success");
}
