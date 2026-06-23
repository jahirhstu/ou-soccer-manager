import { AppShell } from "../../(shell)";
import { saveProgram } from "@/lib/actions/crud";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";

export default async function NewProgramPage() {
  const profile = await getCurrentProfile();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("organization_enabled_programs")
    .select("program_template_id,program_templates!inner(name)")
    .eq("organization_id", profile?.organization_id ?? "")
    .eq("enabled", true);
  return (
    <AppShell>
      <form action={saveProgram} className="panel grid max-w-xl gap-3 p-5">
        <h1 className="section-title">New program</h1>
        <input className="input" name="name" placeholder="Program name, e.g. Soccer or Summer Picnic" required />
        <select className="input" name="program_template_id" required defaultValue="">
          <option disabled value="">Select an enabled template</option>
          {(data ?? []).map((item: any) => {
            const template = Array.isArray(item.program_templates) ? item.program_templates[0] : item.program_templates;
            return <option key={item.program_template_id} value={item.program_template_id}>{template?.name}</option>;
          })}
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
