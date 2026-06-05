import Link from "next/link";
import { SessionFixtureGenerator, type FixtureGame } from "@/components/SessionFixtureGenerator";
import { hasPermission, isSessionScoreReadOnly } from "@/lib/permissions";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { AppShell } from "../../../(shell)";

export default async function SessionFixturePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const profile = await getCurrentProfile();
  const canEdit = hasPermission(profile?.role, "manage_attendance");
  const [{ data: session }, { data: teams }, { data: matches }] = await Promise.all([
    supabase.from("sessions").select("id,name,session_date,start_time,end_time,status").eq("id", id).single(),
    supabase.from("session_teams").select("id,name").eq("session_id", id).order("name"),
    supabase.from("session_matches").select("*").eq("session_id", id).order("display_order", { nullsFirst: false }).order("match_number")
  ]);
  const readOnly = isSessionScoreReadOnly(profile?.role, session, currentTorontoDate());
  const hasPlayedMatches = (matches ?? []).some((match: any) => match.result_status === "played");
  const existingGames: FixtureGame[] = (matches ?? []).map((match: any) => ({
    key: match.id,
    matchNumber: match.match_number,
    displayOrder: match.display_order ?? undefined,
    teamAId: match.team_a_id,
    teamBId: match.team_b_id,
    awayTeamId: match.away_team_id ?? "",
    scheduledStartTime: match.scheduled_start_time ?? "",
    scheduledEndTime: match.scheduled_end_time ?? ""
  }));
  const teamOptions = (teams ?? []).map((team: any) => ({ id: team.id, name: team.name }));

  return (
    <AppShell>
      <div className="grid gap-5">
        {!canEdit ? (
          <div className="panel border-dashed p-10 text-center text-sm text-slate-500">Only captains and admins can manage fixtures.</div>
        ) : teamOptions.length < 2 ? (
          <div className="panel border-dashed p-10 text-center text-sm text-slate-500">
            Create at least two teams before generating a fixture.
            <div className="mt-3"><Link className="btn-secondary" href={`/public/sessions/${id}/teams`}>Build teams</Link></div>
          </div>
        ) : (
          <SessionFixtureGenerator
            existingGames={existingGames}
            hasPlayedMatches={hasPlayedMatches}
            readOnly={readOnly}
            sessionEndTime={session?.end_time ?? null}
            sessionId={id}
            sessionLabel={session?.name ?? session?.session_date ?? "Session"}
            sessionStartTime={session?.start_time ?? null}
            teams={teamOptions}
          />
        )}
      </div>
    </AppShell>
  );
}

function currentTorontoDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Toronto",
    year: "numeric"
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}
