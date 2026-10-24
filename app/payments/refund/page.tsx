import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { RefundForm } from "@/components/RefundForm";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseServerClient, getCurrentProfile, getCurrentProgram } from "@/lib/supabase/server";
import { AppShell } from "../../(shell)";

export default async function RecordRefundPage({
  searchParams
}: {
  searchParams: Promise<{ player?: string; season?: string }>;
}) {
  const filters = await searchParams;
  const profile = await getCurrentProfile();
  if (!hasPermission(profile?.role, "manage_finance")) redirect("/public/report");
  const program = await getCurrentProgram();
  const supabase = await createSupabaseServerClient();
  let query = supabase.from("player_season_payment_summary")
    .select("player_id,player_name,season_id,season_name,credit_amount")
    .gt("credit_amount", 0);
  let hasSeasons = true;
  if (program?.id) {
    const { data: seasons, error } = await supabase.from("seasons").select("id").eq("program_id", program.id);
    if (error) throw new Error(error.message);
    hasSeasons = Boolean(seasons?.length);
    if (hasSeasons) query = query.in("season_id", (seasons ?? []).map((season) => season.id));
  }
  const { data, error } = hasSeasons
    ? await query.order("player_name")
    : { data: [], error: null };
  if (error) throw new Error(error.message);
  const options = (data ?? []).map((row) => ({
    playerId: row.player_id,
    playerName: row.player_name,
    seasonId: row.season_id,
    seasonName: row.season_name,
    credit: String(row.credit_amount ?? 0)
  }));
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const part = (type: string) => dateParts.find((item) => item.type === type)?.value ?? "";
  const today = `${part("year")}-${part("month")}-${part("day")}`;

  return (
    <AppShell>
      <RefundForm options={options} initialPlayerId={filters.player} initialSeasonId={filters.season} submissionId={randomUUID()} today={today} />
    </AppShell>
  );
}
