"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { attendanceSchema, paymentSchema, playerSchema, seasonSchema, sessionSchema } from "../schemas";
import { hasPermission } from "../permissions";
import { createSupabaseServerClient, getCurrentProfile } from "../supabase/server";
import { applySessionUsage } from "./session-usage";

async function requirePermission(permission: Parameters<typeof hasPermission>[1]) {
  const profile = await getCurrentProfile();
  if (!hasPermission(profile?.role, permission)) throw new Error("Unauthorized");
  return profile;
}

export async function saveSeason(formData: FormData) {
  const profile = await requirePermission("manage_finance");
  const parsed = seasonSchema.parse(formDataToObject(formData));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("seasons").insert({ ...parsed, created_by: profile.id });
  if (error) throw new Error(error.message);
  revalidatePath("/seasons");
  redirect("/seasons");
}

export async function saveSession(formData: FormData) {
  const profile = await requirePermission("manage_finance");
  const parsed = sessionSchema.parse(formDataToObject(formData));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("sessions").insert({ ...parsed, created_by: profile.id });
  if (error) throw new Error(error.message);
  revalidatePath("/sessions");
  redirect("/sessions");
}

export async function savePlayer(formData: FormData) {
  await requirePermission("manage_finance");
  const parsed = playerSchema.parse(formDataToObject(formData));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("players").insert(parsed);
  if (error) throw new Error(error.message);
  revalidatePath("/players");
  redirect("/players");
}

export async function updatePlayer(formData: FormData) {
  const profile = await requirePermission("manage_finance");
  const playerId = String(formData.get("player_id"));
  const parsed = playerSchema.parse(formDataToObject(formData));
  const supabase = await createSupabaseServerClient();
  const { data: oldPlayer } = await supabase.from("players").select("*").eq("id", playerId).single();
  const { error } = await supabase.from("players").update(parsed).eq("id", playerId);
  if (error) throw new Error(error.message);
  await supabase.from("audit_logs").insert({
    actor_id: profile.id,
    action: "player_updated",
    entity_type: "players",
    entity_id: playerId,
    old_data: oldPlayer,
    new_data: parsed
  });
  revalidatePath("/players");
  revalidatePath(`/players/${playerId}`);
  redirect(`/players/${playerId}`);
}

export async function savePayment(formData: FormData) {
  const profile = await requirePermission("manage_finance");
  const parsed = paymentSchema.parse(formDataToObject(formData));
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("payments").insert({ ...parsed, created_by: profile.id }).select("id").single();
  if (error) throw new Error(error.message);
  await supabase.from("ledger_entries").insert({
    season_id: parsed.season_id,
    player_id: parsed.player_id,
    type: "payment_received",
    amount: parsed.amount,
    sessions_count: parsed.sessions_covered,
    description: parsed.reference_note ?? "Manual payment recorded",
    created_by: profile.id
  });
  await supabase.from("audit_logs").insert({
    actor_id: profile.id,
    action: "payment_created",
    entity_type: "payments",
    entity_id: data?.id,
    new_data: parsed
  });
  revalidatePath("/payments");
  redirect("/payments");
}

export async function upsertAttendance(formData: FormData) {
  const profile = await requirePermission("manage_attendance");
  const parsed = attendanceSchema.parse(formDataToObject(formData));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("attendance")
    .upsert({ ...parsed, created_by: profile.id }, { onConflict: "session_id,player_id" });
  if (error) throw new Error(error.message);
  revalidatePath("/attendance");
}

export async function updateSessionPrice(formData: FormData) {
  await requirePermission("manage_finance");
  const sessionId = String(formData.get("session_id"));
  const price = formData.get("price_per_session");
  const parsedPrice = price === "" || price == null ? null : Number(price);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("sessions")
    .update({ price_per_session: parsedPrice })
    .eq("id", sessionId);
  if (error) throw new Error(error.message);
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/sessions");
}

export async function completeSession(formData: FormData) {
  const profile = await requirePermission("manage_finance");
  const sessionId = String(formData.get("session_id"));
  const supabase = await createSupabaseServerClient();

  await applySessionUsage({
    supabase,
    sessionId,
    actorId: profile.id,
    source: "session_completed",
    markSessionCompleted: true
  });

  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/sessions");
  revalidatePath("/reports/payments");
}

function formDataToObject(formData: FormData) {
  return Object.fromEntries(
    Array.from(formData.entries()).map(([key, value]) => [key, value === "" ? null : value])
  );
}
