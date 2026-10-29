import { BarChart3 } from "lucide-react";
import { ProgramSelect, SeasonSelect, SessionSelect } from "@/components/FormControls";
import { PerformanceRatingsForm, type PerformancePlayerRow } from "@/components/PerformanceRatingsForm";
import { hasPermission } from "@/lib/permissions";
import { compareText } from "@/lib/sorting";
import { createSupabaseServerClient, getCurrentProfile, getCurrentProgram } from "@/lib/supabase/server";
import { AppShell } from "../(shell)";

type PerformanceRatingRow = {
  player_id: string;
  attacking_skill_percent: number | null;
  defending_skill_percent: number | null;
  goalkeeping_skill_percent: number | null;
  notes: string | null;
};

export default async function PerformancePage({
  searchParams
}: {
  searchParams: Promise<{ program?: string; season?: string; session?: string }>;
}) {
  const filters = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [profile, currentProgram, { data: players }] = await Promise.all([
    getCurrentProfile(),
    getCurrentProgram(),
    supabase.from("players").select("*").eq("status", "active").order("display_name")
  ]);
  const programs = currentProgram ? [currentProgram] : [];
  const selectedProgramId = currentProgram?.id ?? filters.program ?? programs?.[0]?.id ?? "";
  const selectedProgram = programs?.find((program) => program.id === selectedProgramId) ?? currentProgram;
  const selectedSeasonId = filters.season ?? "";
  const selectedSessionId = filters.session ?? "";
  let seasonsQuery = supabase.from("seasons").select("*").order("name");
  let sessionsQuery = supabase.from("sessions").select("*,playgrounds(name)").order("session_date", { ascending: false });
  if (selectedProgramId) {
    seasonsQuery = seasonsQuery.eq("program_id", selectedProgramId);
    sessionsQuery = sessionsQuery.eq("program_id", selectedProgramId);
  }
  if (selectedSeasonId) sessionsQuery = sessionsQuery.eq("season_id", selectedSeasonId);

  const [{ data: seasons }, { data: sessions }, { data: ratings }, { data: filteredAttendance }] = await Promise.all([
    selectedProgramId ? seasonsQuery : Promise.resolve({ data: [] }),
    selectedProgramId ? sessionsQuery : Promise.resolve({ data: [] }),
    selectedProgramId
      ? supabase
        .from("player_performance_ratings")
        .select("player_id,attacking_skill_percent,defending_skill_percent,goalkeeping_skill_percent,notes")
        .eq("program_id", selectedProgramId)
      : Promise.resolve({ data: [] }),
    selectedSessionId
      ? supabase.from("attendance").select("player_id").eq("session_id", selectedSessionId)
      : selectedSeasonId
        ? supabase
          .from("attendance")
          .select("player_id,sessions!inner(program_id,season_id)")
          .eq("sessions.program_id", selectedProgramId)
          .eq("sessions.season_id", selectedSeasonId)
        : Promise.resolve({ data: null })
  ]);
  const filteredPlayerIds = selectedSeasonId || selectedSessionId
    ? new Set((filteredAttendance ?? []).map((row) => row.player_id))
    : null;
  const ratingsByPlayer = new Map((ratings ?? []).map((rating: PerformanceRatingRow) => [rating.player_id, rating]));
  const canEdit = hasPermission(profile?.role, "manage_attendance");
  const rows: PerformancePlayerRow[] = [...(players ?? [])]
    .filter((player) => !filteredPlayerIds || filteredPlayerIds.has(player.id))
    .sort((left, right) => compareText(left.display_name, right.display_name))
    .map((player) => {
      const rating = ratingsByPlayer.get(player.id);
      return {
        attacking_skill_percent: rating?.attacking_skill_percent ?? null,
        defending_skill_percent: rating?.defending_skill_percent ?? null,
        display_name: player.display_name,
        goalkeeping_skill_percent: rating?.goalkeeping_skill_percent ?? null,
        id: player.id,
        notes: rating?.notes ?? null,
        preferred_position: player.preferred_position ?? null
      };
    });

  return (
    <AppShell>
      <div className="grid gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="page-title">Player performance</h1>
            <p className="text-sm text-slate-500">
              Rate player capacity for this program. These ratings appear during the team draft.
            </p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
            <BarChart3 className="h-3.5 w-3.5" />
            {selectedProgram?.name ?? "No program"}
          </span>
        </div>

        {programs?.length ? (
          <form className="panel grid gap-3 p-4 md:grid-cols-[1fr_1fr_1fr_auto]">
            {!currentProgram?.id ? (
              <ProgramSelect defaultValue={selectedProgramId} emptyLabel="Choose program" name="program" programs={programs} required />
            ) : (
              <input name="program" type="hidden" value={selectedProgramId} />
            )}
            <SeasonSelect defaultValue={selectedSeasonId} emptyLabel="All seasons" name="season" required={false} seasons={seasons ?? []} />
            <SessionSelect defaultValue={selectedSessionId} emptyLabel="All sessions" name="session" required={false} sessions={sessions ?? []} />
            <button className="btn-secondary justify-center">View</button>
          </form>
        ) : null}

        {!selectedProgramId ? (
          <div className="panel border-dashed p-10 text-center text-sm text-slate-500">
            Create a program before rating player performance.
          </div>
        ) : !canEdit ? (
          <div className="panel border-dashed p-10 text-center text-sm text-slate-500">
            Only admins and captains can edit performance ratings.
          </div>
        ) : (
          <PerformanceRatingsForm players={rows} programId={selectedProgramId} />
        )}
      </div>
    </AppShell>
  );
}
