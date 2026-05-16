import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { completeSession, updateSessionPrice } from "@/lib/actions/crud";
import { money } from "@/lib/utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "../../(shell)";

export default async function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [{ data: session }, { data: attendance }, { data: dropouts }, { data: goals }, { data: teams }] = await Promise.all([
    supabase.from("sessions").select("*,seasons(name)").eq("id", id).single(),
    supabase.from("attendance").select("*,players(display_name)").eq("session_id", id),
    supabase.from("dropouts").select("*,original:players!dropouts_original_player_id_fkey(display_name),replacement:players!dropouts_replacement_player_id_fkey(display_name)").eq("session_id", id),
    supabase.from("goals").select("*,session_teams(name),scorer:players!goals_scorer_id_fkey(display_name),assist:players!goals_assist_player_id_fkey(display_name)").eq("session_id", id),
    supabase
      .from("session_teams")
      .select("*,captain:players!session_teams_captain_player_id_fkey(display_name),session_team_players(players(display_name))")
      .eq("session_id", id)
      .order("name")
  ]);
  return (
    <AppShell>
      <div className="grid gap-6">
        <section className="panel p-5">
          <h1 className="page-title">{session?.name ?? session?.session_date}</h1>
          <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-600">
            {session?.name ? <span>{session.session_date}</span> : null}
            <span>{(session as any)?.seasons?.name}</span>
            <span>{session?.location ?? "-"}</span>
            <span>{session?.price_per_session == null ? "Season default price" : `${money(session.price_per_session)} session price`}</span>
            {session?.status ? <StatusBadge status={session.status} /> : null}
            <span>Score: {session?.team_a_score ?? "-"}-{session?.team_b_score ?? "-"}</span>
          </div>
          <form action={updateSessionPrice} className="mt-4 flex max-w-sm gap-2">
            <input name="session_id" type="hidden" value={id} />
            <input
              className="input flex-1"
              defaultValue={session?.price_per_session ?? ""}
              name="price_per_session"
              placeholder="Session price override"
              step="0.01"
              type="number"
            />
            <button className="btn-secondary">Update price</button>
          </form>
          {session?.status !== "completed" ? (
            <form action={completeSession} className="mt-3">
              <input name="session_id" type="hidden" value={id} />
              <button className="btn-primary">
                Mark session completed
              </button>
            </form>
          ) : null}
        </section>
        <section className="grid gap-3">
          <h2 className="section-title">Teams</h2>
          <DataTable rows={teams ?? []} columns={[
            { header: "Team", cell: (row) => row.name },
            { header: "Captain", cell: (row: any) => row.captain?.display_name ?? "-" },
            { header: "Score", cell: (row) => row.score ?? "-" },
            { header: "Players", cell: (row: any) => (row.session_team_players ?? []).map((item: any) => item.players?.display_name).filter(Boolean).join(", ") || "-" }
          ]} />
        </section>
        <section className="grid gap-3">
          <h2 className="section-title">Attendance</h2>
          <DataTable rows={attendance ?? []} columns={[
            { header: "Player", cell: (row: any) => row.players?.display_name ?? "-" },
            { header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
            { header: "Notes", cell: (row) => row.notes ?? "-" }
          ]} />
        </section>
        <section className="grid gap-3">
          <h2 className="section-title">Dropouts and replacements</h2>
          <DataTable rows={dropouts ?? []} columns={[
            { header: "Original", cell: (row: any) => row.original?.display_name ?? "-" },
            { header: "Replacement", cell: (row: any) => row.replacement?.display_name ?? "-" },
            { header: "Transfer type", cell: (row) => row.transfer_type.replaceAll("_", " ") }
          ]} />
        </section>
        <section className="grid gap-3">
          <h2 className="section-title">Goals and assists</h2>
          <DataTable rows={goals ?? []} columns={[
            { header: "Scorer", cell: (row: any) => row.scorer?.display_name ?? "-" },
            { header: "Assist", cell: (row: any) => row.assist?.display_name ?? "-" },
            { header: "Team", cell: (row: any) => row.session_teams?.name ?? row.team ?? "-" },
            { header: "Goals", cell: (row) => row.goal_count ?? 1 }
          ]} />
        </section>
      </div>
    </AppShell>
  );
}
