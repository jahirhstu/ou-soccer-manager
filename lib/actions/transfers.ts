"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { hasPermission } from "../permissions";
import { createSupabaseServerClient, getCurrentProfile } from "../supabase/server";

export type TransferActionState = { error?: string } | null;

const schema = z.object({
  player_id: z.string().uuid(),
  source_season_id: z.string().uuid(),
  destination_season_id: z.string().uuid(),
  submission_id: z.string().uuid(),
  amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/, "Enter an amount in dollars and cents."),
  transfer_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a transfer date."),
  note: z.string().trim().max(300).optional()
});

export async function carryForwardPlayerCredit(_state: TransferActionState, formData: FormData): Promise<TransferActionState> {
  const profile = await getCurrentProfile();
  if (!hasPermission(profile?.role, "manage_finance")) return { error: "Only admins can carry credit forward." };
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the transfer details." };
  if (parsed.data.source_season_id === parsed.data.destination_season_id) return { error: "Choose two different seasons." };
  const amount = Number(parsed.data.amount);
  if (!Number.isSafeInteger(Math.round(amount * 100)) || amount <= 0) return { error: "Enter a positive transfer amount." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("carry_forward_player_credit", {
    p_player_id: parsed.data.player_id,
    p_source_season_id: parsed.data.source_season_id,
    p_destination_season_id: parsed.data.destination_season_id,
    p_amount: parsed.data.amount,
    p_transfer_date: parsed.data.transfer_date,
    p_note: parsed.data.note || null,
    p_submission_id: parsed.data.submission_id
  });
  if (error) return { error: error.message };

  for (const path of ["/payments", "/reports/payments", "/dashboard", "/public/report", `/players/${parsed.data.player_id}`, `/seasons/${parsed.data.source_season_id}`, `/seasons/${parsed.data.destination_season_id}`]) revalidatePath(path);
  redirect("/payments?success=transfer_saved");
}
