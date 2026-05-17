import { PlaygroundSelect, SeasonSelect } from "@/components/FormControls";
import { saveSession } from "@/lib/actions/crud";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "../../(shell)";

export default async function NewSessionPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: seasons }, { data: playgrounds }] = await Promise.all([
    supabase.from("seasons").select("*").order("name"),
    supabase.from("playgrounds").select("*").order("name")
  ]);
  return (
    <AppShell>
      <form action={saveSession} className="panel grid max-w-xl gap-3 p-5">
        <h1 className="section-title">New session</h1>
        <SeasonSelect seasons={seasons ?? []} />
        <input className="input" name="name" placeholder="Session name" />
        <input className="input" name="session_date" type="date" required />
        <PlaygroundSelect playgrounds={playgrounds ?? []} />
        <input className="input" name="location" placeholder="New playground name or location" />
        <input className="input" name="start_time" type="time" />
        <input className="input" name="end_time" type="time" />
        <input className="input" name="price_per_session" placeholder="Session price override" step="0.01" type="number" />
        <select className="input" name="status"><option value="scheduled">Scheduled</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select>
        <textarea className="input min-h-24" name="notes" placeholder="Notes" />
        <button className="btn-primary w-fit">Save</button>
      </form>
    </AppShell>
  );
}
