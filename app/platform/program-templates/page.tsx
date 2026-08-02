import Link from "next/link";
import { redirect } from "next/navigation";
import { createProgramTemplateAction } from "@/lib/actions/platform";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ProgramTemplatesPage() {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data: account } = await supabase.from("platform_accounts").select("role").eq("profile_id", auth.user.id).maybeSingle();
  if (account?.role !== "platform_owner") redirect("/platform/organizations");

  const [{ data: templates }, { data: modules }] = await Promise.all([
    supabase
      .from("program_templates")
      .select("id,key,name,category,status,program_template_modules(module_key,default_enabled,required,display_order)")
      .order("name"),
    supabase.from("module_catalog").select("key,name,description,status").eq("status", "active").order("name")
  ]);

  return (
    <main className="mx-auto grid max-w-5xl gap-6 px-4 py-10">
      <div>
        <Link className="text-sm text-slate-500 hover:text-ink" href="/platform/organizations">← Organizations</Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Program templates</h1>
        <p className="mt-1 text-sm text-slate-500">Platform-owned blueprints. Changes to defaults do not mutate existing programs.</p>
      </div>

      <form action={createProgramTemplateAction} className="panel grid gap-4 p-5">
        <h2 className="section-title">Create template</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <input className="input" name="name" placeholder="Template name" required />
          <input className="input" name="key" placeholder="template-key" required />
          <select className="input" name="category" defaultValue="generic">
            <option value="sport">Sport</option>
            <option value="event">Event</option>
            <option value="social">Social</option>
            <option value="generic">Generic</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          {(modules ?? []).map((module) => (
            <label className="rounded-lg border border-line px-3 py-2 text-sm" key={module.key}>
              {["members", "activities"].includes(module.key) ? (
                <><input className="mr-2" checked disabled readOnly type="checkbox" /><input name="modules" type="hidden" value={module.key} /></>
              ) : <input className="mr-2" name="modules" type="checkbox" value={module.key} />}
              {module.name}{["members", "activities"].includes(module.key) ? " · required" : ""}
            </label>
          ))}
        </div>
        <button className="btn-primary w-fit">Create template</button>
      </form>

      <div className="grid gap-3">
        {(templates ?? []).map((template: any) => (
          <section className="panel p-5" key={template.id}>
            <div className="flex flex-wrap justify-between gap-2">
              <div><h2 className="font-semibold">{template.name}</h2><p className="text-sm text-slate-500">{template.key} · {template.category} · {template.status}</p></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1">
              {[...(template.program_template_modules ?? [])].sort((a: any, b: any) => a.display_order - b.display_order).map((module: any) => (
                <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700" key={module.module_key}>
                  {module.module_key.replaceAll("_", " ")}{module.required ? " · required" : ""}
                </span>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
