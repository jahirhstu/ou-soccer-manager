import { AppShell } from "../(shell)";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { cleanupClubData, setOrganizationDefaultProgram, updatePublicReportSettings } from "@/lib/actions/admin";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { hasOrganizationAdminAuthority } from "@/lib/organization-access";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ cleanup?: string }> }) {
  const [{ cleanup }, profile] = await Promise.all([searchParams, getCurrentProfile()]);
  const supabase = await createSupabaseServerClient();
  const isAdmin = await hasOrganizationAdminAuthority(supabase, profile?.organization_id);
  const [{ data: organization }, { data: organizationSettings }, { data: programs }] = profile?.organization_id ? await Promise.all([
    supabase.from("organizations").select("public_reports_enabled").eq("id", profile.organization_id).maybeSingle(),
    supabase.from("organization_settings").select("public_balances_enabled,public_payments_enabled").eq("organization_id", profile.organization_id).maybeSingle(),
    supabase.from("programs").select("id,name,slug,is_default").eq("organization_id", profile.organization_id).eq("status", "active").order("name")
  ]) : [{ data: null }, { data: null }, { data: [] }];

  return (
    <AppShell>
      <div className="grid gap-5">
        <h1 className="page-title">Settings</h1>

        {cleanup === "success" ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
            Club data cleanup completed. App users, profiles, roles, and login access were kept.
          </div>
        ) : null}
        {cleanup === "confirmation-required" ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900">
            Type CLEANUP before running the data cleanup.
          </div>
        ) : null}

        <section className="panel p-5 text-sm text-slate-600">
          Manage roles in Supabase profiles. Service role keys stay server-side only.
        </section>

        {isAdmin ? (
          <form action={updatePublicReportSettings} className="panel grid gap-3 p-5">
            <h2 className="section-title">Public reports</h2>
            <label className="flex items-center gap-2 text-sm"><input defaultChecked={organization?.public_reports_enabled ?? false} name="public_reports_enabled" type="checkbox" /> Enable public reports</label>
            <label className="flex items-center gap-2 text-sm"><input defaultChecked={organizationSettings?.public_payments_enabled ?? false} name="public_payments_enabled" type="checkbox" /> Show payment totals publicly</label>
            <label className="flex items-center gap-2 text-sm"><input defaultChecked={organizationSettings?.public_balances_enabled ?? false} name="public_balances_enabled" type="checkbox" /> Show balances and amounts owed publicly</label>
            <button className="btn-primary w-fit">Save report settings</button>
          </form>
        ) : null}

        {isAdmin && programs?.length ? (
          <form action={setOrganizationDefaultProgram} className="panel grid gap-3 p-5 sm:grid-cols-[1fr_auto]">
            <div className="sm:col-span-2">
              <h2 className="section-title">Default program</h2>
              <p className="mt-1 text-sm text-slate-500">Organization URLs without a program use this program.</p>
            </div>
            <select className="input" defaultValue={programs.find((program) => program.is_default)?.id ?? ""} name="program_id" required>
              <option disabled value="">Choose a default program</option>
              {programs.map((program) => <option key={program.id} value={program.id}>{program.name} (/{program.slug})</option>)}
            </select>
            <button className="btn-primary">Save default program</button>
          </form>
        ) : null}

        {isAdmin ? (
          <section className="panel grid gap-4 border-rose-200 p-5">
            <div>
              <h2 className="section-title text-rose-900">Admin data cleanup</h2>
              <p className="mt-2 text-sm text-slate-600">
                Remove club operating data including leagues, seasons, sessions, teams, players, payments, attendance, goals, imports, and ledger entries.
                Playgrounds are also removed. Login users, profiles, roles, and access information are kept.
              </p>
            </div>
            <form action={cleanupClubData} className="grid gap-3 sm:max-w-md">
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                Type CLEANUP to confirm
                <input className="input" name="confirmation" placeholder="CLEANUP" required />
              </label>
              <div>
                <ConfirmDialog message="This will permanently delete club data but keep app users and profiles. Continue?">
                  Cleanup club data
                </ConfirmDialog>
              </div>
            </form>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
