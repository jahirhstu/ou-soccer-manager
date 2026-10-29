import Link from "next/link";
import { redirect } from "next/navigation";
import { assignPlatformSuperadminAction, setOrganizationTemplateAction, setPlatformDefaultContextAction } from "@/lib/actions/platform";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function PlatformOrganizationsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data: account } = await supabase.from("platform_accounts").select("role").eq("profile_id", auth.user.id).maybeSingle();
  if (!account) redirect("/select-context");
  const [{ data: organizations }, { data: templates }, { data: enabled }, { data: programs }] = await Promise.all([
    supabase.from("organizations").select("id,name,slug,public_reports_enabled,is_default").order("name"),
    supabase.from("program_templates").select("id,name,key,status").eq("status", "active").order("name"),
    supabase.from("organization_enabled_programs").select("organization_id,program_template_id,enabled"),
    supabase.from("programs").select("id,organization_id,name,slug,is_default").eq("status", "active").order("name")
  ]);
  const defaultOrganization = (organizations ?? []).find((organization) => organization.is_default);
  const defaultProgram = (programs ?? []).find((program) => program.is_default && program.organization_id === defaultOrganization?.id);
  return (
    <main className="mx-auto grid max-w-5xl gap-6 px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Platform organizations</h1>
      <div className="flex flex-wrap gap-2">
        <Link className="btn-primary" href="/platform/organizations/new">Onboard organization</Link>
        {account.role === "platform_owner" ? <Link className="btn-secondary" href="/platform/program-templates">Program templates</Link> : null}
      </div>
      {account.role === "platform_owner" ? (
        <form action={setPlatformDefaultContextAction} className="panel grid gap-3 p-5 sm:grid-cols-[1fr_auto]">
          <div>
            <h2 className="font-semibold text-ink">Default public context</h2>
            <p className="mt-1 text-sm text-slate-500">Bare public URLs redirect to this organization and program.</p>
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <select className="input min-w-64 flex-1" defaultValue={defaultProgram?.id ?? ""} name="program_id" required>
              <option disabled value="">Choose organization and program</option>
              {(organizations ?? []).map((organization) => (
                <optgroup key={organization.id} label={organization.name}>
                  {(programs ?? []).filter((program) => program.organization_id === organization.id).map((program) => (
                    <option key={program.id} value={program.id}>{program.name} (/{organization.slug}/{program.slug})</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button className="btn-primary">Save default</button>
          </div>
        </form>
      ) : null}
      <div className="grid gap-4">
        {(organizations ?? []).map((organization) => (
          <section className="panel grid gap-3 p-5" key={organization.id}>
            <div><h2 className="font-semibold"><Link className="hover:underline" href={`/platform/organizations/${organization.id}`}>{organization.name}</Link>{organization.is_default ? " · Public default" : ""}</h2><p className="text-sm text-slate-500">/{organization.slug}</p></div>
            <div className="flex flex-wrap gap-2">
              {(templates ?? []).map((template) => {
                const active = (enabled ?? []).some((item) => item.organization_id === organization.id && item.program_template_id === template.id && item.enabled);
                return (
                  <form action={setOrganizationTemplateAction} key={template.id}>
                    <input name="organization_id" type="hidden" value={organization.id} />
                    <input name="program_template_id" type="hidden" value={template.id} />
                    <input name="enabled" type="hidden" value={active ? "false" : "true"} />
                    <button className={active ? "btn-primary" : "btn-secondary"}>{template.name}: {active ? "enabled" : "disabled"}</button>
                  </form>
                );
              })}
            </div>
            {account.role === "platform_owner" ? (
              <form action={assignPlatformSuperadminAction} className="flex flex-wrap gap-2 border-t border-line pt-3">
                <input name="organization_id" type="hidden" value={organization.id} />
                <input className="input flex-1" name="email" placeholder="Existing user email" type="email" required />
                <button className="btn-secondary">Assign superadmin</button>
              </form>
            ) : null}
          </section>
        ))}
      </div>
    </main>
  );
}
