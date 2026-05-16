import { DataTable } from "@/components/DataTable";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "../../(shell)";

export default async function AttendanceReportPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("attendance_report");
  return (
    <AppShell>
      <h1 className="page-title mb-5">Attendance report</h1>
      <DataTable rows={data ?? []} columns={[
        { header: "Player", cell: (row: any) => row.player_name },
        { header: "Played sessions", cell: (row: any) => row.sessions_played },
        { header: "Missed sessions", cell: (row: any) => row.sessions_missed },
        { header: "Dropped", cell: (row: any) => row.dropped_sessions },
        { header: "Replacement", cell: (row: any) => row.replacement_sessions }
      ]} />
    </AppShell>
  );
}
