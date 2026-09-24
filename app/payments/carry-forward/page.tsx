import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { CarryForwardForm } from "@/components/CarryForwardForm";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseServerClient, getCurrentProfile, getCurrentProgram } from "@/lib/supabase/server";
import { AppShell } from "../../(shell)";

export default async function CarryForwardPage({ searchParams }: { searchParams: Promise<{ player?: string; season?: string }> }) {
  const filters = await searchParams;
  const profile = await getCurrentProfile();
  if (!hasPermission(profile?.role, "manage_finance")) redirect("/public/report");
  const program = await getCurrentProgram();
  const supabase = await createSupabaseServerClient();
  let seasonsQuery = supabase.from("seasons").select("id,name,program_id");
  if (program?.id) seasonsQuery = seasonsQuery.eq("program_id", program.id);
  const [{ data: seasons, error: seasonsError }, { data: balances, error: balancesError }] = await Promise.all([
    seasonsQuery.order("name"),
    supabase.from("player_season_payment_summary").select("player_id,player_name,season_id,credit_amount,owes_money")
  ]);
  if (seasonsError || balancesError) throw new Error(seasonsError?.message ?? balancesError?.message);
  const seasonById = new Map((seasons ?? []).map((season) => [season.id, season]));
  const options = (balances ?? []).filter((row) => {
    const source = seasonById.get(row.season_id);
    return Number(row.credit_amount ?? 0) > 0 && source?.program_id &&
      (seasons ?? []).some((season) => season.program_id === source.program_id && season.id !== source.id);
  })
    .map((row) => ({
      playerId: row.player_id,
      playerName: row.player_name,
      seasonId: row.season_id,
      seasonName: seasonById.get(row.season_id)!.name,
      programId: seasonById.get(row.season_id)!.program_id,
      credit: String(row.credit_amount)
    }));
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const part = (type: string) => dateParts.find((item) => item.type === type)?.value ?? "";
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  return <AppShell><CarryForwardForm
    options={options}
    seasons={(seasons ?? []).filter((season) => Boolean(season.program_id))}
    balances={(balances ?? []).map((row) => ({ playerId: row.player_id, seasonId: row.season_id, credit: String(row.credit_amount ?? 0), owes: String(row.owes_money ?? 0) }))}
    initialPlayerId={filters.player} initialSeasonId={filters.season} submissionId={randomUUID()} today={today}
  /></AppShell>;
}
