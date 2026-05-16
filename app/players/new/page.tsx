import { savePlayer } from "@/lib/actions/crud";
import { AppShell } from "../../(shell)";

export default function NewPlayerPage() {
  return (
    <AppShell>
      <form action={savePlayer} className="panel grid max-w-xl gap-3 p-5">
        <h1 className="section-title">New player</h1>
        <input className="input" name="display_name" placeholder="Display name" required />
        <input className="input" name="phone" placeholder="Phone" />
        <input className="input" name="email" placeholder="Email" type="email" />
        <select className="input" name="status"><option value="active">Active</option><option value="inactive">Inactive</option></select>
        <input className="input" name="preferred_position" placeholder="Preferred position" />
        <textarea className="input min-h-24" name="notes" placeholder="Notes" />
        <button className="btn-primary w-fit">Save</button>
      </form>
    </AppShell>
  );
}
