import { updatePlayer } from "@/lib/actions/crud";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "../../../(shell)";

export default async function EditPlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: player } = await supabase.from("players").select("*").eq("id", id).single();

  return (
    <AppShell>
      <form action={updatePlayer} className="panel grid max-w-xl gap-3 p-5">
        <input name="player_id" type="hidden" value={id} />
        <h1 className="section-title">Edit player</h1>
        <input className="input" defaultValue={player?.display_name ?? ""} name="display_name" placeholder="Display name" required />
        <input className="input" defaultValue={player?.phone ?? ""} name="phone" placeholder="Phone" />
        <input className="input" defaultValue={player?.email ?? ""} name="email" placeholder="Email" type="email" />
        <select className="input" defaultValue={player?.status ?? "active"} name="status">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <input className="input" defaultValue={player?.preferred_position ?? ""} name="preferred_position" placeholder="Preferred position" />
        <textarea className="input min-h-24" defaultValue={player?.notes ?? ""} name="notes" placeholder="Notes" />
        <button className="btn-primary w-fit">Save changes</button>
      </form>
    </AppShell>
  );
}
