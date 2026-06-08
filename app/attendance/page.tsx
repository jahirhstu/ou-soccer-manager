import { PlayerSelect, SessionSelect } from "@/components/FormControls";
import { upsertAttendance } from "@/lib/actions/crud";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { compareText } from "@/lib/sorting";
import { createSupabaseServerClient, getCurrentProgram } from "@/lib/supabase/server";
import { AppShell } from "../(shell)";

type SortKey = "recent" | "date" | "player" | "status";

export default async function AttendancePage({
  searchParams
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const filters = await searchParams;
  const supabase = await createSupabaseServerClient();
  const program = await getCurrentProgram();
  let sessionsQuery = supabase.from("sessions").select("*,playgrounds(name)").order("session_date", { ascending: false });
  let attendanceQuery = supabase.from("attendance").select("*,players(display_name),sessions(session_date)").order("created_at", { ascending: false }).limit(100);
  if (program?.id) {
    sessionsQuery = sessionsQuery.eq("program_id", program.id);
    attendanceQuery = attendanceQuery.eq("program_id", program.id);
  }
  const [{ data: players }, { data: sessions }, { data: attendance }] = await Promise.all([
    supabase.from("players").select("*").order("display_name"),
    sessionsQuery,
    attendanceQuery
  ]);
  const rows = sortRows(attendance ?? [], sortKey(filters.sort));
  return (
    <AppShell>
      <div className="grid gap-5">
        <h1 className="page-title">{program?.name ? `${program.name} attendance` : "Attendance"}</h1>
        <form action={upsertAttendance} className="panel grid gap-3 p-4 md:grid-cols-[1fr_1fr_180px_auto]">
          <SessionSelect sessions={sessions ?? []} />
          <PlayerSelect players={players ?? []} />
          <select className="input" name="status"><option value="confirmed">Confirmed</option><option value="played">Played</option><option value="absent">Absent</option><option value="dropped">Dropped</option><option value="replacement">Replacement</option><option value="waitlisted">Waitlisted</option></select>
          <button className="btn-primary justify-center">Save</button>
        </form>
        <DataTable rows={rows} columns={[
          { header: "Date", cell: (row: any) => row.sessions?.session_date ?? "-" },
          { header: "Player", cell: (row: any) => row.players?.display_name ?? "-" },
          { header: "Status", cell: (row) => <StatusBadge status={row.status} /> }
        ]} />
      </div>
    </AppShell>
  );
}

function sortKey(value: string | undefined): SortKey {
  if (value === "date" || value === "player" || value === "status") return value;
  return "recent";
}

function sortRows(rows: any[], key: SortKey) {
  return [...rows].sort((left, right) => {
    if (key === "date") return compareText(right.sessions?.session_date, left.sessions?.session_date) || compareText(left.players?.display_name, right.players?.display_name);
    if (key === "player") return compareText(left.players?.display_name, right.players?.display_name) || compareText(right.sessions?.session_date, left.sessions?.session_date);
    if (key === "status") return compareText(left.status, right.status) || compareText(left.players?.display_name, right.players?.display_name);
    return compareText(right.created_at, left.created_at) || compareText(left.players?.display_name, right.players?.display_name);
  });
}
