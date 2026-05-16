import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { money } from "@/lib/utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "../../(shell)";
import Link from "next/link";
import { Pencil } from "lucide-react";

export default async function PlayerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [{ data: player }, { data: payments }, { data: attendance }, { data: ledger }, { data: goals }, { data: summary }] = await Promise.all([
    supabase.from("players").select("*").eq("id", id).single(),
    supabase.from("payments").select("*,seasons(name)").eq("player_id", id).order("payment_date", { ascending: false }),
    supabase.from("attendance").select("*,sessions(session_date)").eq("player_id", id).order("created_at", { ascending: false }),
    supabase.from("ledger_entries").select("*").eq("player_id", id).order("created_at", { ascending: false }),
    supabase.from("goals").select("*,sessions(session_date),assist:players!goals_assist_player_id_fkey(display_name)").eq("scorer_id", id),
    supabase.from("player_season_payment_summary").select("*").eq("player_id", id)
  ]);
  return (
    <AppShell>
      <div className="grid gap-6">
        <section className="panel p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="page-title">{player?.display_name ?? "Player"}</h1>
            <Link className="btn-secondary" href={`/players/${id}/edit`}>
              <Pencil className="h-4 w-4" />
              Edit player
            </Link>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-600">
            {player?.status ? <StatusBadge status={player.status} /> : null}
            <span>{player?.email ?? "-"}</span>
            <span>{player?.preferred_position ?? "-"}</span>
          </div>
        </section>
        <section className="grid gap-3">
          <h2 className="section-title">Balance summary</h2>
          <DataTable rows={summary ?? []} columns={[
            { header: "Season", cell: (row) => row.season_name ?? "-" },
            { header: "Paid", cell: (row) => money(row.total_paid_amount) },
            { header: "Paid sessions", cell: (row) => row.total_paid_sessions ?? 0 },
            { header: "Played", cell: (row) => row.total_played_sessions ?? 0 },
            { header: "Remaining", cell: (row) => row.remaining_sessions ?? 0 },
            { header: "Credit", cell: (row) => money(row.credit_amount) }
          ]} />
        </section>
        <section className="grid gap-3">
          <h2 className="section-title">Payment history</h2>
          <DataTable rows={payments ?? []} columns={[
            { header: "Season", cell: (row: any) => row.seasons?.name ?? "-" },
            { header: "Date", cell: (row) => row.payment_date },
            { header: "Amount", cell: (row) => money(row.amount) },
            { header: "Sessions", cell: (row) => row.sessions_covered ?? "-" }
          ]} />
        </section>
        <section className="grid gap-3">
          <h2 className="section-title">Attendance history</h2>
          <DataTable rows={attendance ?? []} columns={[
            { header: "Date", cell: (row: any) => row.sessions?.session_date ?? "-" },
            { header: "Status", cell: (row) => <StatusBadge status={row.status} /> }
          ]} />
        </section>
        <section className="grid gap-3">
          <h2 className="section-title">Ledger</h2>
          <DataTable rows={ledger ?? []} columns={[
            { header: "Type", cell: (row) => row.type.replaceAll("_", " ") },
            { header: "Amount", cell: (row) => money(row.amount) },
            { header: "Sessions", cell: (row) => row.sessions_count ?? "-" },
            { header: "Description", cell: (row) => row.description ?? "-" }
          ]} />
        </section>
        <section className="grid gap-3">
          <h2 className="section-title">Goals and assists</h2>
          <DataTable rows={goals ?? []} columns={[
            { header: "Date", cell: (row: any) => row.sessions?.session_date ?? "-" },
            { header: "Goals", cell: (row) => row.goal_count ?? 1 },
            { header: "Assist", cell: (row: any) => row.assist?.display_name ?? "-" }
          ]} />
        </section>
      </div>
    </AppShell>
  );
}
