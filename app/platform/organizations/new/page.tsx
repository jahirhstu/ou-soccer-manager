import Link from "next/link";
import { redirect } from "next/navigation";
import { OrganizationOnboardingForm } from "@/components/OrganizationOnboardingForm";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function NewPlatformOrganizationPage() {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data: account } = await supabase.from("platform_accounts").select("role").eq("profile_id", auth.user.id).maybeSingle();
  if (!account || !["platform_owner", "platform_superadmin"].includes(account.role)) redirect("/select-context");

  const { data: templates, error } = await supabase
    .from("program_templates")
    .select("id,key,name,category,program_template_modules(module_key,default_enabled,required,display_order,module_catalog(name,description))")
    .eq("status", "active")
    .order("name");
  if (error) throw new Error(error.message);

  const normalized = (templates ?? []).map((template: any) => ({
    ...template,
    program_template_modules: [...(template.program_template_modules ?? [])].sort((a, b) => a.display_order - b.display_order)
  }));

  return (
    <main className="mx-auto grid max-w-5xl gap-6 px-4 py-10">
      <div>
        <Link className="text-sm text-slate-500 hover:text-ink" href="/platform/organizations">← Organizations</Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Onboard organization</h1>
        <p className="mt-1 text-sm text-slate-500">Organization, entitlements, programs, modules, and the first owner are created together.</p>
      </div>
      <OrganizationOnboardingForm templates={normalized} />
    </main>
  );
}
