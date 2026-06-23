import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { tenantPath } from "@/lib/tenant";

export default async function SelectContextPage() {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data: memberships } = await supabase
    .from("organization_members")
    .select("organization_id,role,organizations!inner(name,slug)")
    .eq("profile_id", auth.user.id)
    .eq("status", "active")
    .order("created_at");
  const { data: programMemberships } = await supabase
    .from("program_members")
    .select("organization_id,role,programs!inner(name,slug)")
    .eq("profile_id", auth.user.id)
    .eq("status", "active");
  const { data: organizationPrograms } = await supabase.from("programs").select("id,organization_id,name,slug").eq("status", "active").order("name");
  const { data: platformAccount } = await supabase.from("platform_accounts").select("role").eq("profile_id", auth.user.id).maybeSingle();
  if (!memberships?.length && !platformAccount) redirect("/join");
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <section className="panel grid w-full max-w-xl gap-4 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Choose a program</h1>
          <p className="mt-1 text-sm text-slate-500">You will stay in this program until you use the Switch button.</p>
        </div>
        {platformAccount ? <Link className="rounded-md border border-line p-4 font-semibold text-pitch" href="/platform/organizations">Platform administration ({platformAccount.role})</Link> : null}
        {(memberships ?? []).map((membership: any) => {
          const organization = Array.isArray(membership.organizations) ? membership.organizations[0] : membership.organizations;
          const memberPrograms = (programMemberships ?? []).filter((program) => program.organization_id === membership.organization_id);
          const visiblePrograms = membership.role === "owner" || membership.role === "admin"
            ? (organizationPrograms ?? []).filter((program) => program.organization_id === membership.organization_id).map((program) => ({ role: "manager", programs: program }))
            : memberPrograms;
          return (
            <div className="grid gap-2 rounded-md border border-line p-4" key={membership.organization_id}>
              <div className="font-semibold text-ink">{organization.name}</div>
              <Link className="text-xs font-medium text-slate-500 hover:text-pitch" href={tenantPath("/dashboard", organization.slug)}>Organization dashboard</Link>
              {visiblePrograms.map((item: any) => {
                const program = Array.isArray(item.programs) ? item.programs[0] : item.programs;
                return <Link className="text-sm text-slate-700 hover:text-pitch" href={tenantPath("/dashboard", organization.slug, program.slug)} key={program.slug}>{program.name} ({item.role})</Link>;
              })}
            </div>
          );
        })}
      </section>
    </main>
  );
}
