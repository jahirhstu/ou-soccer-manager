import { PlayerSelect, ProgramSelect, SeasonSelect, SessionSelect } from "@/components/FormControls";
import { savePayment } from "@/lib/actions/crud";
import { createSupabaseServerClient, getCurrentProgram } from "@/lib/supabase/server";
import { AppShell } from "../../(shell)";

export default async function NewPaymentPage() {
  const supabase = await createSupabaseServerClient();
  const currentProgram = await getCurrentProgram();
  let seasonsQuery = supabase.from("seasons").select("*").order("name");
  let sessionsQuery = supabase.from("sessions").select("*,playgrounds(name)").order("session_date", { ascending: false });
  if (currentProgram?.id) {
    seasonsQuery = seasonsQuery.eq("program_id", currentProgram.id);
    sessionsQuery = sessionsQuery.eq("program_id", currentProgram.id);
  }
  const [{ data: seasons }, { data: players }, { data: sessions }, { data: programs }] = await Promise.all([
    seasonsQuery,
    supabase.from("players").select("*").order("display_name"),
    sessionsQuery,
    supabase.from("programs").select("*").eq("id", currentProgram?.id ?? "").eq("status", "active")
  ]);
  return (
    <AppShell>
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
    </AppShell>
  );
}
