import { Trophy } from "lucide-react";
import { AppShell } from "../../(shell)";
import { DataTable } from "@/components/DataTable";
import { LeagueTeamForm } from "@/components/LeagueTeamForm";
import { StatusBadge } from "@/components/StatusBadge";
import { generateLeagueFixtures, saveLeagueMatchResult } from "@/lib/actions/leagues";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";

export default async function LeagueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [
    { data: league },
    { data: teams },
    { data: matches },
    { data: standings },
    { data: players },
    profile
  ] = await Promise.all([
    supabase.from("leagues").select("*,seasons(name)").eq("id", id).single(),
    supabase
      .from("league_teams")
      .select("*,captain:players!league_teams_captain_player_id_fkey(display_name),league_team_players(players(id,display_name))")
      .eq("league_id", id)
      .order("seed_order", { ascending: true, nullsFirst: false })
      .order("name"),
    supabase
      .from("league_matches")
      .select("*,team_a:league_teams!league_matches_team_a_id_fkey(name),team_b:league_teams!league_matches_team_b_id_fkey(name)")
      .eq("league_id", id)
      .order("match_number"),
    supabase.rpc("league_standings", { p_league_id: id }),
    supabase.from("players").select("id,display_name").eq("status", "active").order("display_name"),
    getCurrentProfile()
  ]);
  const canManage = hasPermission(profile?.role, "manage_all");

  return (
    <AppShell>
      <div className="grid gap-6">
        <section className="panel p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="page-title">{league?.name ?? "League"}</h1>
              <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-600">
                <span>{league?.seasons?.name ?? "No linked season"}</span>
                <span>{league?.start_date ?? "-"} to {league?.end_date ?? "-"}</span>
                {league?.status ? <StatusBadge status={league.status} /> : null}
              </div>
            </div>
            <div className="inline-flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
              <Trophy className="h-4 w-4" />
              {league?.points_for_win ?? 3}/{league?.points_for_draw ?? 1}/{league?.points_for_loss ?? 0}
            </div>
          </div>
        </section>

        <section className="grid gap-3">
          <h2 className="section-title">Standings</h2>
          <DataTable rows={standings ?? []} columns={[
            { header: "Rank", cell: (row) => row.rank },
            { header: "Team", cell: (row) => row.team_name },
            { header: "P", cell: (row) => row.played },
            { header: "W", cell: (row) => row.wins },
            { header: "D", cell: (row) => row.draws },
            { header: "L", cell: (row) => row.losses },
            { header: "GF", cell: (row) => row.goals_for },
            { header: "GA", cell: (row) => row.goals_against },
            { header: "GD", cell: (row) => signed(row.goal_difference) },
            { header: "Pts", cell: (row) => <span className="font-semibold text-ink">{row.points}</span> }
          ]} />
        </section>

        <section className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="section-title">Fixtures</h2>
            {canManage ? (
              <form action={generateLeagueFixtures}>
                <input name="league_id" type="hidden" value={id} />
                <button className="btn-secondary">Generate fixtures</button>
              </form>
            ) : null}
          </div>
          <div className="grid gap-2">
            {(matches ?? []).map((match: any) => (
              <form action={saveLeagueMatchResult} className="panel grid gap-2 p-3 md:grid-cols-[80px_1fr_90px_24px_90px_auto] md:items-center" key={match.id}>
                <input name="league_id" type="hidden" value={id} />
                <input name="match_id" type="hidden" value={match.id} />
                <div className="text-sm font-semibold text-slate-500">R{match.round_number} G{match.match_number}</div>
                <div className="min-w-0 text-sm font-semibold text-ink">{match.team_a?.name ?? "-"} vs {match.team_b?.name ?? "-"}</div>
                <input className="input min-h-9 px-2 text-center" defaultValue={match.team_a_score ?? ""} min="0" name="team_a_score" type="number" />
                <div className="hidden text-center text-sm font-semibold text-slate-400 md:block">-</div>
                <input className="input min-h-9 px-2 text-center" defaultValue={match.team_b_score ?? ""} min="0" name="team_b_score" type="number" />
                {canManage ? <button className="btn-secondary min-h-9 px-3">Save</button> : <StatusBadge status={match.status} />}
              </form>
            ))}
            {!matches?.length ? <div className="panel border-dashed p-8 text-center text-sm text-slate-500">No fixtures generated yet.</div> : null}
          </div>
        </section>

        <section className="grid gap-3">
          <h2 className="section-title">Teams</h2>
          <DataTable rows={teams ?? []} columns={[
            { header: "Team", cell: (row) => row.name },
            { header: "Captain", cell: (row: any) => row.captain?.display_name ?? "-" },
            { header: "Players", cell: (row: any) => (row.league_team_players ?? []).map((item: any) => item.players?.display_name).filter(Boolean).join(", ") || "-" }
          ]} />
          {canManage ? <LeagueTeamForm leagueId={id} players={players ?? []} /> : null}
        </section>
      </div>
    </AppShell>
  );
}

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}
