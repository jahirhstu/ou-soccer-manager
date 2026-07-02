"use server";

import { revalidatePath } from "next/cache";
import { hasPermission } from "../permissions";
import { createSupabaseServerClient, getCurrentProfile } from "../supabase/server";

export async function submitPaymentSentNotification(_: unknown, formData: FormData) {
  try {
    const playerId = String(formData.get("playerId") ?? "");
    const seasonId = String(formData.get("seasonId") ?? "");
    if (!playerId || !seasonId) return { error: "Player and season are required." };

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("submit_payment_sent_notification", {
      p_player_id: playerId,
      p_season_id: seasonId
    });
    if (error) throw new Error(error.message);
    if (data && typeof data === "object" && "error" in data) return { error: String(data.error) };

    revalidatePath("/public/report");
    revalidatePath("/notifications");
    return {
      success: true,
      duplicate: Boolean((data as { duplicate?: boolean } | null)?.duplicate),
      amount: Number((data as { amount?: number } | null)?.amount ?? 0)
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not notify admins." };
  }
}

export async function markNotificationRead(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!hasPermission(profile?.role, "manage_all")) throw new Error("Only admins can update notifications.");

  const notificationId = String(formData.get("notificationId") ?? "");
  if (!notificationId) throw new Error("Notification is required.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("notifications")
    .update({
      read_at: new Date().toISOString(),
      read_by: profile.id
    })
    .eq("id", notificationId)
    .is("read_at", null);
  if (error) throw new Error(error.message);

  revalidatePath("/notifications");
  revalidatePath("/dashboard");
}
