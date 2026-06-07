import { PlayerSelect, SeasonSelect, SessionSelect } from "@/components/FormControls";
import { savePayment } from "@/lib/actions/crud";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "../../(shell)";

export default async function NewPaymentPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: seasons }, { data: players }, { data: sessions }] = await Promise.all([
    supabase.from("seasons").select("*").order("name"),
    supabase.from("players").select("*").order("display_name"),
    supabase.from("sessions").select("*,playgrounds(name)").order("session_date", { ascending: false })
  ]);
  return (
    <AppShell>
      <form action={savePayment} className="panel grid max-w-xl gap-3 p-5">
        <h1 className="section-title">Record payment</h1>
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
