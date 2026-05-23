import { TeamBuilder, type TeamBuilderData } from "@/components/TeamBuilder";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { AppShell } from "../../../../(shell)";

export default async function EditTeamPlayersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [{ data, error }, profile] = await Promise.all([
    supabase.rpc("public_session_team_builder", { p_session_id: id }),
    getCurrentProfile()
  ]);
  const canEdit = hasPermission(profile?.role, "manage_attendance");

  return (
    <AppShell>
      <div className="grid gap-5">
        <section className="panel p-5">
          <h1 className="page-title">Edit team players</h1>
          <p className="mt-2 text-sm text-slate-500">Add, remove, and move players between teams for this session.</p>
        </section>
        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            Team editing is not ready. Run the latest database migrations, then refresh.
          </div>
        ) : null}
        {!canEdit ? (
          <div className="panel border-dashed p-10 text-center text-sm text-slate-500">Only captains and admins can edit teams.</div>
        ) : data ? (
          <TeamBuilder canEdit data={data as TeamBuilderData} sessionId={id} />
        ) : (
          <div className="panel border-dashed p-10 text-center text-sm text-slate-500">Session not found.</div>
        )}
      </div>
    </AppShell>
  );
}
