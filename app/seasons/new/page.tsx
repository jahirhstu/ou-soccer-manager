import { saveSeason } from "@/lib/actions/crud";
import { AppShell } from "../../(shell)";

export default function NewSeasonPage() {
  return (
    <AppShell>
      <Form title="New season" action={saveSeason}>
        <input className="input" name="name" placeholder="Season name" required />
        <input className="input" name="start_date" type="date" />
        <input className="input" name="end_date" type="date" />
        <input className="input" name="total_planned_sessions" placeholder="Total planned sessions" type="number" />
        <input className="input" name="price_per_session" placeholder="Price per session" step="0.01" type="number" required />
        <select className="input" name="status"><option value="draft">Draft</option><option value="active">Active</option><option value="archived">Archived</option></select>
        <textarea className="input min-h-24" name="notes" placeholder="Notes" />
      </Form>
    </AppShell>
  );
}

function Form({ title, action, children }: { title: string; action: (formData: FormData) => Promise<void>; children: React.ReactNode }) {
  return <form action={action} className="panel grid max-w-xl gap-3 p-5"><h1 className="section-title">{title}</h1>{children}<button className="btn-primary w-fit">Save</button></form>;
}
