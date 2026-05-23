import { LineupBuilder } from "@/components/LineupBuilder";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { AppShell } from "../../../(shell)";

export default async function SessionLineupsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const profile = await getCurrentProfile();
  const canEdit = hasPermission(profile?.role, "manage_attendance");
  const [{ data: session }, { data: teams }, { data: lineups }] = await Promise.all([
    supabase.from("sessions").select("id,name,session_date").eq("id", id).single(),
    supabase
      .from("session_teams")
      .select("id,name,session_team_players(players(id,display_name))")
      .eq("session_id", id)
      .order("name"),
    supabase.from("session_team_lineups").select("*").eq("session_id", id)
  ]);
  const teamOptions = (teams ?? []).map((team: any) => ({
    id: team.id,
    name: team.name,
    players: (team.session_team_players ?? [])
      .map((row: any) => row.players ? { id: row.players.id, name: row.players.display_name } : null)
      .filter((player: { id: string; name: string } | null): player is { id: string; name: string } => Boolean(player))
  }));
  const lineupRows = (lineups ?? []).map((lineup: any) => ({
    sessionTeamId: lineup.session_team_id,
    playerCount: lineup.player_count,
    formation: lineup.formation,
    positions: Array.isArray(lineup.positions) ? lineup.positions : []
  }));

  return (
    <AppShell>
      <div className="grid gap-5">
        <section className="panel p-5">
          <h1 className="page-title">Lineup builder</h1>
          <p className="mt-2 text-sm text-slate-500">
            {session?.name ?? session?.session_date ?? "Session"}: choose a player count and place team players on the field.
          </p>
        </section>
        {!canEdit ? (
          <div className="panel border-dashed p-10 text-center text-sm text-slate-500">Only captains and admins can save lineups.</div>
        ) : !teamOptions.length ? (
          <div className="panel border-dashed p-10 text-center text-sm text-slate-500">Build teams before creating lineups.</div>
        ) : (
          <LineupBuilder lineups={lineupRows} sessionId={id} teams={teamOptions} />
        )}
      </div>
    </AppShell>
  );
}
