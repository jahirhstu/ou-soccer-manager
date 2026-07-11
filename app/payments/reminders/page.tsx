import { redirect } from "next/navigation";
import { MessageSquareText } from "lucide-react";
import { WhatsappReminderBuilder, type WhatsappReminderRow } from "@/components/WhatsappReminderBuilder";
import { hasPermission } from "@/lib/permissions";
import { compareNumberDesc, compareText } from "@/lib/sorting";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { AppShell } from "../../(shell)";

type PaymentSummaryRow = {
  player_id: string;
  player_name: string | null;
  season_id: string;
  season_name: string | null;
  owes_money: number | string | null;
};

type PlayerRow = {
  id: string;
  phone: string | null;
};

type PaymentNotificationKey = {
  player_id: string;
  season_id: string;
  amount: number | string;
};

export default async function PaymentRemindersPage() {
  const profile = await getCurrentProfile();
  if (!hasPermission(profile?.role, "manage_finance")) redirect("/public/report");

  const supabase = await createSupabaseServerClient();
  const [{ data: summaries }, { data: players }, { data: notificationKeys }] = await Promise.all([
    supabase.from("player_season_payment_summary").select("player_id,player_name,season_id,season_name,owes_money"),
    supabase.from("players").select("id,phone"),
    supabase.rpc("public_payment_notification_keys")
  ]);
  const phoneByPlayerId = new Map(((players ?? []) as PlayerRow[]).map((player) => [player.id, player.phone ?? ""]));
  const pendingKeys = new Set(((notificationKeys ?? []) as PaymentNotificationKey[]).map(notificationKey));
  const rows = ((summaries ?? []) as PaymentSummaryRow[])
    .map((row): WhatsappReminderRow => {
      const amount = Number(row.owes_money ?? 0);
      return {
        playerId: row.player_id,
        playerName: row.player_name ?? "Unknown player",
        seasonId: row.season_id,
        seasonName: row.season_name ?? "Season",
        amount,
        phone: phoneByPlayerId.get(row.player_id) ?? "",
        pendingPaymentSent: pendingKeys.has(notificationKey({ player_id: row.player_id, season_id: row.season_id, amount }))
      };
    })
    .filter((row) => row.amount > 0)
    .sort((left, right) => compareNumberDesc(left.amount, right.amount) || compareText(left.playerName, right.playerName));

  return (
    <AppShell>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">WhatsApp reminders</h1>
          <p className="mt-1 text-sm text-slate-500">Review owed balances before opening WhatsApp.</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
          <MessageSquareText className="h-4 w-4" />
          {rows.length} owing
        </span>
      </div>
      <WhatsappReminderBuilder rows={rows} />
    </AppShell>
  );
}

function notificationKey(notificationKey: PaymentNotificationKey) {
  return `${notificationKey.player_id}:${notificationKey.season_id}:${Number(notificationKey.amount ?? 0).toFixed(2)}`;
}
