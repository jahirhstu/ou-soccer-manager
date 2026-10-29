import { AppShell } from "../../(shell)";
import { saveLeague } from "@/lib/actions/leagues";
import { createSupabaseServerClient, getCurrentProgram } from "@/lib/supabase/server";

export default async function NewLeaguePage() {
  const supabase = await createSupabaseServerClient();
  const program = await getCurrentProgram();
  const { data: seasons } = program?.id
    ? await supabase.from("seasons").select("id,name").eq("program_id", program.id).order("name")
    : { data: [] };

  return (
    <AppShell>
      <form action={saveLeague} className="panel grid max-w-xl gap-3 p-5">
        <input name="program_id" type="hidden" value={program?.id ?? ""} />
        <h1 className="section-title">New league</h1>
        <input className="input" name="name" placeholder="League name" required />
        <select className="input" name="season_id">
          <option value="">No linked season</option>
          {(seasons ?? []).map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}
        </select>
        <div className="grid gap-2 sm:grid-cols-3">
          <input className="input" defaultValue="3" min="0" name="points_for_win" placeholder="Win pts" type="number" />
          <input className="input" defaultValue="1" min="0" name="points_for_draw" placeholder="Draw pts" type="number" />
          <input className="input" defaultValue="0" min="0" name="points_for_loss" placeholder="Loss pts" type="number" />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="input" name="start_date" type="date" />
          <input className="input" name="end_date" type="date" />
        </div>
        <select className="input" name="status">
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="archived">Archived</option>
        </select>
        <textarea className="input min-h-24" name="notes" placeholder="Notes" />
        <button className="btn-primary w-fit" disabled={!program?.id}>Save</button>
        {!program?.id ? <p className="text-sm text-rose-700">Open this page from a program URL before creating a league.</p> : null}
      </form>
    </AppShell>
  );
}
