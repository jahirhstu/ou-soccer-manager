import { LineupBuilder } from "@/components/LineupBuilder";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { AppShell } from "../../../(shell)";

export default async function SessionLineupsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const profile = await getCurrentProfile();
  const [{ data: session }, { data: teams }, { data: lineups }] = await Promise.all([
    supabase.from("sessions").select("id,name,session_date").eq("id", id).single(),
    supabase.rpc("lineup_builder_teams", { p_session_id: id }),
    supabase.rpc("lineup_builder_lineups", { p_session_id: id })
  ]);
  const teamOptions = (teams ?? []).map((team: any) => ({
    id: team.id,
    name: team.name,
    players: Array.isArray(team.players) ? team.players : []
  }));
  const lineupRows = (lineups ?? [])
    .map((lineup: any) => ({
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
        {!profile?.player_id ? (
          <div className="panel border-dashed p-10 text-center text-sm text-slate-500">Your account must be linked to a player profile before you can edit a team lineup.</div>
        ) : !teamOptions.length ? (
          <div className="panel border-dashed p-10 text-center text-sm text-slate-500">You are not assigned to a team for this session.</div>
        ) : (
          <LineupBuilder lineups={lineupRows} sessionId={id} teams={teamOptions} />
        )}
      </div>
    </AppShell>
  );
}
