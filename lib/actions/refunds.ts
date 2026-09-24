"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { hasPermission } from "../permissions";
import { createSupabaseServerClient, getCurrentProfile } from "../supabase/server";

export type RefundActionState = { error?: string } | null;

const refundSchema = z.object({
  player_id: z.string().uuid(),
  season_id: z.string().uuid(),
  submission_id: z.string().uuid(),
  amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/, "Enter an amount in dollars and cents."),
  refund_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date the refund was sent."),
  method: z.enum(["e-transfer", "cash", "other"]),
  reference: z.string().trim().max(300).optional()
});

export async function recordPlayerRefund(_state: RefundActionState, formData: FormData): Promise<RefundActionState> {
  const profile = await getCurrentProfile();
  if (!hasPermission(profile?.role, "manage_finance")) return { error: "Only admins can record refunds." };

  const parsed = refundSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the refund details." };
  const amount = Number(parsed.data.amount);
  if (!Number.isSafeInteger(Math.round(amount * 100)) || amount <= 0) {
    return { error: "Enter a positive refund amount." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("record_player_refund", {
    p_player_id: parsed.data.player_id,
    p_season_id: parsed.data.season_id,
    p_amount: parsed.data.amount,
    p_refund_date: parsed.data.refund_date,
    p_method: parsed.data.method,
    p_reference: parsed.data.reference || null,
    p_submission_id: parsed.data.submission_id
  });
  if (error) return { error: error.message };

  revalidatePath("/payments");
  revalidatePath("/reports/payments");
  revalidatePath("/dashboard");
  revalidatePath("/public/report");
  revalidatePath(`/players/${parsed.data.player_id}`);
  revalidatePath(`/seasons/${parsed.data.season_id}`);
  redirect("/payments?success=refund_saved");
}
