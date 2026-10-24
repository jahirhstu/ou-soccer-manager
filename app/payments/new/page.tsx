import { PlayerSelect, ProgramSelect, SeasonSelect, SessionSelect } from "@/components/FormControls";
import { savePayment } from "@/lib/actions/crud";
import { createSupabaseServerClient, getCurrentProgram, getCurrentProfile } from "@/lib/supabase/server";
import { PaymentSourceForm } from "@/components/PaymentSourceForm";
import { hasPermission } from "@/lib/permissions";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { AppShell } from "../../(shell)";

export default async function NewPaymentPage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const filters = await searchParams;
  const profile = await getCurrentProfile();
  if (!profile?.organization_id || !hasPermission(profile.role, "manage_finance")) redirect("/public/report");
  const supabase = await createSupabaseServerClient();
  const currentProgram = await getCurrentProgram();
  let seasonsQuery = supabase.from("seasons").select("*").order("name");
  let sessionsQuery = supabase.from("sessions").select("*,playgrounds(name)").order("session_date", { ascending: false });
  if (currentProgram?.id) {
    seasonsQuery = seasonsQuery.eq("program_id", currentProgram.id);
    sessionsQuery = sessionsQuery.eq("program_id", currentProgram.id);
  }
  const [{ data: seasons }, { data: players }, { data: sessions }, { data: programs }, { data: balances, error: balancesError }] = await Promise.all([
    seasonsQuery,
    supabase.from("players").select("*").eq("organization_id", profile.organization_id).order("display_name"),
    sessionsQuery,
    supabase.from("programs").select("*").eq("id", currentProgram?.id ?? "").eq("status", "active"),
    supabase.from("player_season_payment_summary").select("player_id,season_id,credit_amount,owes_money")
  ]);
  if (balancesError) throw new Error(balancesError.message);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const today = ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-");
  return (
    <AppShell>
      <PaymentSourceForm initialSource={filters.source === "credit" ? "credit" : "external"} players={players ?? []} seasons={seasons ?? []} sessions={sessions ?? []}
        balances={(balances ?? []).filter(row => (seasons ?? []).some(season => season.id === row.season_id)).map(row => ({ playerId: row.player_id, seasonId: row.season_id, credit: String(row.credit_amount ?? 0), owes: String(row.owes_money ?? 0) }))}
        submissionId={randomUUID()} today={today}>
      <form action={savePayment} className="panel grid max-w-xl gap-3 p-5">
        <h1 className="section-title">Record payment</h1>
        <ProgramSelect programs={programs ?? []} defaultValue={currentProgram?.id} emptyLabel="Use selected season/session program" />
        <SeasonSelect seasons={seasons ?? []} />
        <SessionSelect sessions={sessions ?? []} required={false} />
        <PlayerSelect players={players ?? []} />
        <input className="input" name="payment_date" type="date" required />
        <input className="input" name="amount" placeholder="Amount" step="0.01" type="number" required />
        <input className="input" name="sessions_covered" placeholder="Paid sessions" step="0.5" type="number" />
        <input className="input" name="payment_method" placeholder="Payment method" />
        <textarea className="input min-h-24" name="reference_note" placeholder="Reference note" />
        <button className="btn-primary w-fit">Save</button>
      </form>
      </PaymentSourceForm>
    </AppShell>
  );
}
