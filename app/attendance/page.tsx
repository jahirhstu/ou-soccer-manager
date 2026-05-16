import { PlayerSelect, SessionSelect } from "@/components/FormControls";
import { upsertAttendance } from "@/lib/actions/crud";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "../(shell)";

export default async function AttendancePage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: players }, { data: sessions }, { data: attendance }] = await Promise.all([
    supabase.from("players").select("*").order("display_name"),
    supabase.from("sessions").select("*").order("session_date", { ascending: false }),
    supabase.from("attendance").select("*,players(display_name),sessions(session_date)").order("created_at", { ascending: false }).limit(100)
  ]);
  return (
    <AppShell>
      <div className="grid gap-5">
        <h1 className="page-title">Attendance</h1>
        <form action={upsertAttendance} className="panel grid gap-3 p-4 md:grid-cols-[1fr_1fr_180px_auto]">
          <SessionSelect sessions={sessions ?? []} />
          <PlayerSelect players={players ?? []} />
          <select className="input" name="status"><option value="confirmed">Confirmed</option><option value="played">Played</option><option value="absent">Absent</option><option value="dropped">Dropped</option><option value="replacement">Replacement</option><option value="waitlisted">Waitlisted</option></select>
          <button className="btn-primary justify-center">Save</button>
        </form>
        <DataTable rows={attendance ?? []} columns={[
          { header: "Date", cell: (row: any) => row.sessions?.session_date ?? "-" },
          { header: "Player", cell: (row: any) => row.players?.display_name ?? "-" },
          { header: "Status", cell: (row) => <StatusBadge status={row.status} /> }
        ]} />
      </div>
    </AppShell>
  );
}
