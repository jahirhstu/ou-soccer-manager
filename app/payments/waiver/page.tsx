import { PlayerSelect, ProgramSelect, SeasonSelect, SessionSelect } from "@/components/FormControls";
import { applySessionFeeWaiver } from "@/lib/actions/crud";
import { createSupabaseServerClient, getCurrentProgram } from "@/lib/supabase/server";
import { AppShell } from "../../(shell)";

export default async function RecordWaiverPage() {
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
      <form action={applySessionFeeWaiver} className="panel grid max-w-xl gap-3 p-5">
        <h1 className="section-title">Record waiver</h1>
        <ProgramSelect programs={programs ?? []} defaultValue={currentProgram?.id} emptyLabel="Use selected season/session program" />
        <SeasonSelect seasons={seasons ?? []} />
        <SessionSelect sessions={sessions ?? []} />
        <PlayerSelect players={players ?? []} />
        <input className="input" min="0" name="waiver_amount" placeholder="Waiver amount" step="0.01" type="number" required />
        <textarea className="input min-h-24" name="waiver_reason" placeholder="Reason" required />
        <button className="btn-primary w-fit">Save waiver</button>
      </form>
    </AppShell>
  );
}
