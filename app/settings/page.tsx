import { AppShell } from "../(shell)";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { cleanupClubData } from "@/lib/actions/admin";
import { hasPermission } from "@/lib/permissions";
import { getCurrentProfile } from "@/lib/supabase/server";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ cleanup?: string }> }) {
  const [{ cleanup }, profile] = await Promise.all([searchParams, getCurrentProfile()]);
  const isAdmin = hasPermission(profile?.role, "manage_all");

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
          <section className="panel grid gap-4 border-rose-200 p-5">
            <div>
              <h2 className="section-title text-rose-900">Admin data cleanup</h2>
              <p className="mt-2 text-sm text-slate-600">
                Remove club operating data including seasons, sessions, teams, players, payments, attendance, goals, imports, and ledger entries.
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
