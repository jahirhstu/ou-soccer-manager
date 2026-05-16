import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { money } from "@/lib/utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "../../(shell)";

export default async function SeasonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [{ data: season }, { data: sessions }, { data: payments }, { data: stats }] = await Promise.all([
    supabase.from("seasons").select("*").eq("id", id).single(),
    supabase.from("sessions").select("*").eq("season_id", id).order("session_date"),
    supabase.from("player_season_payment_summary").select("*").eq("season_id", id),
    supabase.from("player_season_stats_summary").select("*").eq("season_id", id)
  ]);
  return (
    <AppShell>
      <div className="grid gap-6">
        <section className="panel p-5">
          <h1 className="page-title">{season?.name ?? "Season"}</h1>
          <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-600">
            {season?.status ? <StatusBadge status={season.status} /> : null}
            <span>{season?.start_date ?? "-"} to {season?.end_date ?? "-"}</span>
            <span>{money(season?.price_per_session)} per session</span>
          </div>
        </section>
        <section className="grid gap-3">
          <h2 className="section-title">Sessions</h2>
          <DataTable rows={sessions ?? []} columns={[
            { header: "Date", cell: (row) => row.session_date },
            { header: "Location", cell: (row) => row.location ?? "-" },
            { header: "Price", cell: (row) => row.price_per_session == null ? "Season default" : money(row.price_per_session) },
            { header: "Status", cell: (row) => <StatusBadge status={row.status} /> }
          ]} />
        </section>
        <section className="grid gap-3">
          <h2 className="section-title">Payment summary</h2>
          <DataTable rows={payments ?? []} columns={[
            { header: "Player", cell: (row) => row.player_name ?? "-" },
            { header: "Paid sessions", cell: (row) => row.total_paid_sessions ?? 0 },
            { header: "Played", cell: (row) => row.total_played_sessions ?? 0 },
            { header: "Remaining", cell: (row) => row.remaining_sessions ?? 0 },
            { header: "Credit", cell: (row) => money(row.credit_amount) }
          ]} />
        </section>
        <section className="grid gap-3">
          <h2 className="section-title">Stats summary</h2>
          <DataTable rows={stats ?? []} columns={[
            { header: "Player", cell: (row) => row.player_name ?? "-" },
            { header: "Goals", cell: (row) => row.goals ?? 0 },
            { header: "Assists", cell: (row) => row.assists ?? 0 },
            { header: "Appearances", cell: (row) => row.appearances ?? 0 }
          ]} />
        </section>
      </div>
    </AppShell>
  );
}
