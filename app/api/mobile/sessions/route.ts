import { z } from "zod";
import { applySessionUsage } from "@/lib/actions/session-usage";
import { authenticateMobileRequest, mobileApiErrorResponse, requireMobileRole } from "@/lib/supabase/mobile-api";

const inputSchema = z.object({
  organizationId: z.string().uuid(),
  sessionId: z.string().uuid(),
  action: z.enum(["generate_fixture", "save_scores", "save_teams", "save_lineup", "complete", "update_price"]),
  data: z.record(z.string(), z.unknown()).default({})
});

export async function POST(request: Request) {
  try {
    const input = inputSchema.parse(await request.json());
    const { supabase, actor } = await authenticateMobileRequest(request, input.organizationId);
    const { data: session, error: sessionError } = await supabase.from("sessions").select("id,organization_id,session_date,status,start_time").eq("id", input.sessionId).eq("organization_id", actor.organizationId).single();
    if (sessionError) throw new Error(sessionError.message);

    if (input.action === "complete") {
      requireMobileRole(actor, ["admin"]);
      const usage = await applySessionUsage({ supabase: supabase as any, sessionId: input.sessionId, actorId: actor.profileId, source: "session_completed", markSessionCompleted: true });
      return Response.json({ ok: true, usage });
    }
    if (input.action === "update_price") {
      requireMobileRole(actor, ["admin"]);
      const { price } = z.object({ price: z.number().nonnegative().nullable() }).parse(input.data);
      const { error } = await supabase.from("sessions").update({ price_per_session: price }).eq("id", input.sessionId).eq("organization_id", actor.organizationId);
      if (error) throw new Error(error.message);
      return Response.json({ ok: true });
    }
    if (input.action === "save_lineup") {
      if (!actor.playerId) throw new Error("Your account must be linked to a player profile before saving a lineup.");
      const parsed = z.object({ sessionTeamId: z.string().uuid(), playerCount: z.number().int().min(1).max(11), formation: z.string().max(30), positions: z.array(z.record(z.string(), z.unknown())) }).parse(input.data);
      const { data: assignment, error: assignmentError } = await supabase.from("session_team_players").select("id").eq("session_id", input.sessionId).eq("session_team_id", parsed.sessionTeamId).eq("player_id", actor.playerId).maybeSingle();
      if (assignmentError) throw new Error(assignmentError.message);
      if (!assignment) throw new Error("Only players assigned to this team can save its lineup.");
      const { error } = await supabase.from("session_team_lineups").upsert({ organization_id: actor.organizationId, session_id: input.sessionId, session_team_id: parsed.sessionTeamId, player_count: parsed.playerCount, formation: parsed.formation, positions: parsed.positions, created_by: actor.profileId }, { onConflict: "session_team_id" });
      if (error) throw new Error(error.message);
      return Response.json({ ok: true });
    }
    requireMobileRole(actor, ["admin", "captain"]);
    if (session.status === "completed" || (session.session_date < torontoDate() && actor.role !== "admin")) throw new Error("This session is read-only because it is completed or past its date.");

    if (input.action === "save_scores") {
      const { games } = z.object({ games: z.array(z.record(z.string(), z.unknown())) }).parse(input.data);
      const { data, error } = await supabase.rpc("public_save_game_scores", { p_session_id: input.sessionId, p_games: games });
      if (error) throw new Error(error.message);
      if (data && typeof data === "object" && "error" in data) throw new Error(String((data as any).error));
      return Response.json({ ok: true, data });
    }
    if (input.action === "save_teams") {
      const { teams, playersPerTeam } = z.object({ teams: z.array(z.record(z.string(), z.unknown())), playersPerTeam: z.number().int().positive().nullable().optional() }).parse(input.data);
      const { data, error } = await supabase.rpc("save_session_team_builder", { p_session_id: input.sessionId, p_teams: teams, p_players_per_team: playersPerTeam ?? null });
      if (error) throw new Error(error.message);
      if (data && typeof data === "object" && "error" in data) throw new Error(String((data as any).error));
      return Response.json({ ok: true, data });
    }

    const settings = z.object({ repeats: z.number().int().min(1).max(20).default(1), avoidFirstTeamId: z.string().uuid().optional().nullable(), breakAfterGames: z.number().int().nonnegative().default(0), breakLengthMinutes: z.number().int().nonnegative().default(0), firstSegmentMinutes: z.number().int().positive().default(10), secondSegmentMinutes: z.number().int().positive().default(10) }).parse(input.data);
    const [{ data: teams, error: teamError }, { data: played, error: playedError }] = await Promise.all([supabase.from("session_teams").select("id").eq("session_id", input.sessionId).eq("organization_id", actor.organizationId).order("name"), supabase.from("session_matches").select("id").eq("session_id", input.sessionId).eq("result_status", "played").limit(1)]);
    if (teamError || playedError) throw new Error(teamError?.message ?? playedError?.message);
    if (!teams || teams.length < 2) throw new Error("Create at least two teams before generating fixtures.");
    if (played?.length) throw new Error("Fixture cannot be regenerated after scores have been saved.");
    const games = timedPairings(pairings(teams, settings.repeats, settings.avoidFirstTeamId ?? ""), session.start_time, settings);
    const { data: existing } = await supabase.from("session_matches").select("id").eq("session_id", input.sessionId);
    const ids = (existing ?? []).map((row) => row.id);
    if (ids.length) { await supabase.from("goals").delete().in("match_id", ids); const { error } = await supabase.from("session_matches").delete().in("id", ids); if (error) throw new Error(error.message); }
    const rows = games.map((game, index) => ({ organization_id: actor.organizationId, session_id: input.sessionId, match_number: index + 1, display_order: index + 1, team_a_id: game.teamAId, team_b_id: game.teamBId, away_team_id: game.teamBId, scheduled_start_time: game.start, scheduled_end_time: game.end, result_status: "scheduled", team_a_score: 0, team_b_score: 0, created_by: actor.profileId }));
    const { error } = await supabase.from("session_matches").insert(rows);
    if (error) throw new Error(error.message);
    return Response.json({ ok: true, games: rows.length });
  } catch (error) { return mobileApiErrorResponse(error); }
}

function pairings(teams: Array<{ id: string }>, repeats: number, avoid: string) { const base: Array<{ teamAId: string; teamBId: string }> = []; for (let i = 0; i < teams.length; i += 1) for (let j = i + 1; j < teams.length; j += 1) base.push({ teamAId: teams[i].id, teamBId: teams[j].id }); const preferred = base.findIndex((pair) => pair.teamAId !== avoid && pair.teamBId !== avoid); if (preferred > 0) base.unshift(...base.splice(preferred, 1)); return Array.from({ length: repeats }, (_, repeat) => base.map((pair) => repeat % 2 ? { teamAId: pair.teamBId, teamBId: pair.teamAId } : pair)).flat(); }
function timedPairings(games: Array<{ teamAId: string; teamBId: string }>, startTime: string | null, settings: { breakAfterGames: number; breakLengthMinutes: number; firstSegmentMinutes: number; secondSegmentMinutes: number }) { let cursor = parseTime(startTime); return games.map((game, index) => { if (cursor == null) return { ...game, start: null, end: null }; if (settings.breakAfterGames > 0 && index === settings.breakAfterGames) cursor += settings.breakLengthMinutes; const start = formatTime(cursor); cursor += settings.breakAfterGames > 0 && index >= settings.breakAfterGames ? settings.secondSegmentMinutes : settings.firstSegmentMinutes; return { ...game, start, end: formatTime(cursor) }; }); }
function parseTime(value: string | null) { if (!value) return null; const [h, m] = value.split(":").map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null; } function formatTime(value: number) { const normalized = ((value % 1440) + 1440) % 1440; return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`; }
function torontoDate() { const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Toronto" }).formatToParts(new Date()); const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ""; return `${part("year")}-${part("month")}-${part("day")}`; }
