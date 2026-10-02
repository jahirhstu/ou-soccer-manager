"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { hasPermission } from "../permissions";
import { createSupabaseServerClient, getCurrentProfile } from "../supabase/server";

export type ClubTransferState = { error?: string } | null;

const transferSchema = z.object({
  source_season_id: z.string().uuid(),
  destination_season_id: z.string().uuid(),
  submission_id: z.string().uuid(),
  amount: z.string().regex(/^-?\d+(?:\.\d{1,2})?$/, "Enter dollars and cents."),
  transfer_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a transfer date."),
  note: z.string().trim().max(300).optional(),
  confirmed: z.literal("yes")
});

export async function recordClubBalanceTransfer(_state: ClubTransferState, formData: FormData): Promise<ClubTransferState> {
  const profile = await getCurrentProfile();
  if (!hasPermission(profile?.role, "manage_finance")) return { error: "Only admins can carry club balances forward." };
  const parsed = transferSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the transfer details." };
  if (parsed.data.source_season_id === parsed.data.destination_season_id) return { error: "Choose two different seasons." };
  const amount = Number(parsed.data.amount);
  if (!Number.isSafeInteger(Math.round(amount * 100)) || amount === 0) return { error: "Enter a nonzero transfer amount." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("record_club_balance_transfer", {
    p_source_season_id: parsed.data.source_season_id,
    p_destination_season_id: parsed.data.destination_season_id,
    p_amount: parsed.data.amount,
    p_transfer_date: parsed.data.transfer_date,
    p_note: parsed.data.note || null,
    p_submission_id: parsed.data.submission_id
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  redirect(`/dashboard?season=${parsed.data.source_season_id}&success=club_transfer_saved`);
}

export async function reverseClubBalanceTransfer(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!hasPermission(profile?.role, "manage_finance")) throw new Error("Only admins can reverse club transfers.");
  const transferId = z.string().uuid().parse(formData.get("transfer_id"));
  const submissionId = z.string().uuid().parse(formData.get("submission_id"));
  const seasonId = z.string().uuid().parse(formData.get("season_id"));
  if (formData.get("confirmed") !== "yes") throw new Error("Confirm the reversal before submitting.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("reverse_club_balance_transfer", {
    p_transfer_id: transferId, p_submission_id: submissionId
  });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard");
  redirect(`/dashboard?season=${seasonId}&success=club_transfer_reversed`);
}
