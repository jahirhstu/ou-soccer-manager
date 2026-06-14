import { BarChart3 } from "lucide-react";
import { ProgramSelect } from "@/components/FormControls";
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
  searchParams: Promise<{ program?: string }>;
}) {
  const filters = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [profile, currentProgram, { data: programs }, { data: players }] = await Promise.all([
    getCurrentProfile(),
    getCurrentProgram(),
    supabase.from("programs").select("*").eq("status", "active").order("name"),
    supabase.from("players").select("*").eq("status", "active").order("display_name")
  ]);
  const selectedProgramId = currentProgram?.id ?? filters.program ?? programs?.[0]?.id ?? "";
  const selectedProgram = programs?.find((program) => program.id === selectedProgramId) ?? currentProgram;
  const { data: ratings } = selectedProgramId
    ? await supabase
      .from("player_performance_ratings")
      .select("player_id,attacking_skill_percent,defending_skill_percent,goalkeeping_skill_percent,notes")
      .eq("program_id", selectedProgramId)
    : { data: [] };
  const ratingsByPlayer = new Map((ratings ?? []).map((rating: PerformanceRatingRow) => [rating.player_id, rating]));
  const canEdit = hasPermission(profile?.role, "manage_attendance");
  const rows: PerformancePlayerRow[] = [...(players ?? [])]
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

        {!currentProgram?.id && programs?.length ? (
          <form className="panel grid gap-3 p-4 sm:grid-cols-[1fr_auto]">
            <ProgramSelect defaultValue={selectedProgramId} emptyLabel="Choose program" name="program" programs={programs} required />
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
