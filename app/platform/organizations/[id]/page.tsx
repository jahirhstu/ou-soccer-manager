import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setOrganizationTemplateAction, updatePlatformOrganizationAction } from "@/lib/actions/platform";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function PlatformOrganizationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data: account } = await supabase.from("platform_accounts").select("role").eq("profile_id", auth.user.id).maybeSingle();
  if (!account) redirect("/select-context");

  const [
    { data: organization },
    { data: settings },
    { data: templates },
    { data: entitlements },
    { data: programs },
    { data: members },
    { data: invitations }
  ] = await Promise.all([
    supabase.from("organizations").select("id,name,slug,onboarding_status,public_reports_enabled,created_at").eq("id", id).maybeSingle(),
    supabase.from("organization_settings").select("organization_category,currency_code,timezone").eq("organization_id", id).maybeSingle(),
    supabase.from("program_templates").select("id,name,key,status").order("name"),
    supabase.from("organization_enabled_programs").select("program_template_id,enabled").eq("organization_id", id),
    supabase.from("programs").select("id,name,slug,status,is_default,program_modules(module_key,enabled)").eq("organization_id", id).order("name"),
    supabase.from("organization_members").select("id,role,status,profiles(display_name,email)").eq("organization_id", id).order("created_at"),
    supabase.from("invitations").select("id,email,organization_role,program_role,status,expires_at,created_at").eq("organization_id", id).order("created_at", { ascending: false })
  ]);
  if (!organization) notFound();

  return (
    <main className="mx-auto grid max-w-6xl gap-6 px-4 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link className="text-sm text-slate-500 hover:text-ink" href="/platform/organizations">← Organizations</Link>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{organization.name}</h1>
          <p className="text-sm text-slate-500">/{organization.slug} · {organization.onboarding_status}</p>
        </div>
        <form action={updatePlatformOrganizationAction} className="flex gap-2">
          <input name="organization_id" type="hidden" value={id} />
          <select className="input" name="onboarding_status" defaultValue={organization.onboarding_status}>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
          <button className="btn-secondary">Save status</button>
        </form>
      </div>

      <section className="panel grid gap-2 p-5 sm:grid-cols-3">
        <Info label="Category" value={settings?.organization_category} />
        <Info label="Currency" value={settings?.currency_code} />
        <Info label="Time zone" value={settings?.timezone} />
      </section>

      <section className="panel grid gap-4 p-5">
        <div><h2 className="section-title">Eligible templates</h2><p className="text-sm text-slate-500">Disabling an entitlement prevents new programs; it does not delete existing programs.</p></div>
        <div className="flex flex-wrap gap-2">
          {(templates ?? []).filter((template) => template.status === "active").map((template) => {
            const enabled = (entitlements ?? []).some((item) => item.program_template_id === template.id && item.enabled);
            return (
              <form action={setOrganizationTemplateAction} key={template.id}>
                <input name="organization_id" type="hidden" value={id} />
                <input name="program_template_id" type="hidden" value={template.id} />
                <input name="enabled" type="hidden" value={enabled ? "false" : "true"} />
                <button className={enabled ? "btn-primary" : "btn-secondary"}>{template.name}: {enabled ? "enabled" : "disabled"}</button>
              </form>
            );
          })}
        </div>
      </section>

      <section className="panel grid gap-4 p-5">
        <h2 className="section-title">Programs and runtime modules</h2>
        <div className="grid gap-3">
          {(programs ?? []).map((program: any) => (
            <div className="rounded-lg border border-line p-4" key={program.id}>
              <h3 className="font-semibold">{program.name}{program.is_default ? " · Default" : ""}</h3>
              <p className="text-xs text-slate-500">/{organization.slug}/{program.slug} · {program.status}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {(program.program_modules ?? []).map((module: any) => (
                  <span className={module.enabled ? "rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-800" : "rounded bg-slate-100 px-2 py-1 text-xs text-slate-500"} key={module.module_key}>
                    {label(module.module_key)}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel grid gap-4 p-5">
        <h2 className="section-title">Organization users</h2>
        {(members ?? []).length ? (members ?? []).map((member: any) => {
          const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles;
          return <div className="flex justify-between gap-3 border-b border-line pb-2 text-sm last:border-0" key={member.id}>
            <span>{profile?.display_name ?? profile?.email ?? "Unknown user"}</span>
            <span className="text-slate-500">{member.role} · {member.status}</span>
          </div>;
        }) : <p className="text-sm text-slate-500">No accepted users yet. The first owner must accept the invitation.</p>}
      </section>

      <section className="panel grid gap-4 p-5">
        <div><h2 className="section-title">Invitations</h2><p className="text-sm text-slate-500">Invitation secrets are never stored, so links cannot be displayed again.</p></div>
        {(invitations ?? []).map((invitation) => (
          <div className="flex flex-wrap justify-between gap-3 border-b border-line pb-2 text-sm last:border-0" key={invitation.id}>
            <span>{invitation.email ?? "Unrestricted email"} · {invitation.organization_role ?? invitation.program_role}</span>
            <span className="text-slate-500">{invitation.status} · expires {new Date(invitation.expires_at).toLocaleString()}</span>
          </div>
        ))}
      </section>
    </main>
  );
}

function Info({ label: title, value }: { label: string; value?: string | null }) {
  return <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</div><div>{value ?? "—"}</div></div>;
}

function label(value: string) {
  return value.replaceAll("_", " ").replaceAll("-", " ");
}
