import { DataTable } from "@/components/DataTable";
import { compareNumberDesc, compareText } from "@/lib/sorting";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "../../(shell)";

type SortKey = "player" | "played" | "missed" | "dropped" | "replacement";

export default async function AttendanceReportPage({
  searchParams
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const filters = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("attendance_report");
  const rows = sortRows(data ?? [], sortKey(filters.sort));
  return (
    <AppShell>
      <h1 className="page-title mb-5">Attendance report</h1>
      <DataTable rows={rows} columns={[
        { header: "Player", cell: (row: any) => row.player_name },
        { header: "Played sessions", cell: (row: any) => row.sessions_played },
        { header: "Missed sessions", cell: (row: any) => row.sessions_missed },
        { header: "Dropped", cell: (row: any) => row.dropped_sessions },
        { header: "Replacement", cell: (row: any) => row.replacement_sessions }
      ]} />
    </AppShell>
  );
}

function sortKey(value: string | undefined): SortKey {
  if (value === "played" || value === "missed" || value === "dropped" || value === "replacement") return value;
  return "player";
}

function sortRows(rows: any[], key: SortKey) {
  return [...rows].sort((left, right) => {
    if (key === "played") return compareNumberDesc(left.sessions_played, right.sessions_played) || compareText(left.player_name, right.player_name);
    if (key === "missed") return compareNumberDesc(left.sessions_missed, right.sessions_missed) || compareText(left.player_name, right.player_name);
    if (key === "dropped") return compareNumberDesc(left.dropped_sessions, right.dropped_sessions) || compareText(left.player_name, right.player_name);
    if (key === "replacement") return compareNumberDesc(left.replacement_sessions, right.replacement_sessions) || compareText(left.player_name, right.player_name);
    return compareText(left.player_name, right.player_name);
  });
}
