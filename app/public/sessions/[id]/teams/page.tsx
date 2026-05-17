import Link from "next/link";
import { CalendarDays, LayoutDashboard, Lock, MapPin, ShieldCheck } from "lucide-react";
import { TeamBuilder, type TeamBuilderData } from "@/components/TeamBuilder";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";

export default async function PublicSessionTeamsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [{ data, error }, profile] = await Promise.all([
    supabase.rpc("public_session_team_builder", { p_session_id: id }),
    getCurrentProfile()
  ]);
  const report = data as TeamBuilderData | null;
  const canEdit = hasPermission(profile?.role, "manage_attendance");

  return (
    <main className="min-h-screen px-2 py-3 sm:px-4 sm:py-8">
      <div className="mx-auto grid max-w-7xl gap-3 sm:gap-5">
        <header className="panel p-3 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-pitch text-sm font-bold text-white shadow-sm">OU</span>
              <div className="min-w-0">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Public session teams
                  </span>
                  {canEdit ? (
                    <Link className="btn-secondary min-h-8 px-3 py-1 text-xs" href="/dashboard">
                      <LayoutDashboard className="h-3.5 w-3.5" />
                      Dashboard
                    </Link>
                  ) : null}
                </div>
                <h1 className="truncate text-xl font-semibold tracking-tight text-ink sm:text-3xl">
                  {report?.session?.name ?? report?.session?.sessionDate ?? "Session teams"}
                </h1>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600 sm:text-sm">
                  {report?.session?.sessionDate ? (
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarDays className="h-4 w-4" />
                      {report.session.sessionDate}
                    </span>
                  ) : null}
                  {report?.session?.location ? (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="h-4 w-4" />
                      {report.session.location}
                    </span>
                  ) : null}
                  {report?.session?.seasonName ? <span>{report.session.seasonName}</span> : null}
                </div>
              </div>
            </div>
            {canEdit ? (
              <span className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
                Captain/admin edit mode
              </span>
            ) : (
              <Link className="btn-secondary" href="/login">
                <Lock className="h-4 w-4" />
                Login to save
              </Link>
            )}
          </div>
        </header>

        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            Team builder is not ready yet. Run the latest database migration, then refresh this page.
          </div>
        ) : null}

        {report?.session ? (
          <TeamBuilder canEdit={canEdit} data={report} sessionId={id} />
        ) : !error ? (
          <div className="panel border-dashed p-10 text-center text-sm text-slate-500">Session not found.</div>
        ) : null}
      </div>
    </main>
  );
}
