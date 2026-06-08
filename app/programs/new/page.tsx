import { AppShell } from "../../(shell)";
import { saveProgram } from "@/lib/actions/crud";

const activityTypes = [
  { value: "soccer", label: "Soccer" },
  { value: "cricket", label: "Cricket" },
  { value: "badminton", label: "Badminton" },
  { value: "volleyball", label: "Volleyball" },
  { value: "basketball", label: "Basketball" },
  { value: "picnic", label: "Picnic" },
  { value: "outdoor-gathering", label: "Outdoor gathering" },
  { value: "generic-event", label: "Generic event" },
  { value: "generic", label: "Generic" }
];

export default function NewProgramPage() {
  return (
    <AppShell>
      <form action={saveProgram} className="panel grid max-w-xl gap-3 p-5">
        <h1 className="section-title">New program</h1>
        <input className="input" name="name" placeholder="Program name, e.g. Soccer or Summer Picnic" required />
        <select className="input" name="category" defaultValue="sport">
          <option value="sport">Sport</option>
          <option value="event">Event</option>
          <option value="social">Social</option>
          <option value="generic">Generic</option>
        </select>
        <select className="input" name="activity_type" defaultValue="soccer">
          {activityTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
        </select>
        <select className="input" name="status" defaultValue="active">
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
        <textarea className="input min-h-24" name="notes" placeholder="Notes" />
        <button className="btn-primary w-fit">Save</button>
      </form>
    </AppShell>
  );
}
