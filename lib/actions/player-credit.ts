"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { amountInCents } from "@/lib/player-credit";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";

export type PlayerCreditState = { error?: string } | null;
const schema = z.object({
  funding_player_id: z.string().uuid(), recipient_player_id: z.string().uuid(), season_id: z.string().uuid(),
  session_id: z.union([z.string().uuid(), z.literal("")]), submission_id: z.string().uuid(),
  amount: z.string().max(11).regex(/^\d+(?:\.\d{1,2})?$/, "Enter an amount in dollars and cents."),
  transfer_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().trim().max(300), confirmed: z.literal("on")
});

export async function transferPlayerCredit(_state: PlayerCreditState, formData: FormData): Promise<PlayerCreditState> {
  const profile = await getCurrentProfile();
  if (!hasPermission(profile?.role, "manage_finance")) return { error: "Only admins can transfer player credit." };
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the transfer details." };
  const data = parsed.data;
  if (data.funding_player_id === data.recipient_player_id) return { error: "Choose two different players." };
  const cents = amountInCents(data.amount);
  if (cents === null || cents <= BigInt(0) || cents > BigInt(9999999999)) return { error: "Enter a positive transfer amount within the supported range." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("transfer_player_credit", {
    p_funding_player_id: data.funding_player_id, p_recipient_player_id: data.recipient_player_id,
    p_season_id: data.season_id, p_amount: data.amount, p_transfer_date: data.transfer_date,
    p_session_id: data.session_id || null, p_note: data.note || null, p_submission_id: data.submission_id
  });
  if (error) return { error: error.message };
  for (const path of ["/payments", "/payments/new", "/reports/payments", "/dashboard", "/public/report", "/players",
    `/players/${data.funding_player_id}`, `/players/${data.recipient_player_id}`, `/seasons/${data.season_id}`,
    ...(data.session_id ? [`/sessions/${data.session_id}`, `/public/sessions/${data.session_id}`] : [])]) revalidatePath(path);
  redirect("/payments?success=player_credit_transferred");
}
