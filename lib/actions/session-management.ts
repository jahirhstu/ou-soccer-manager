"use server";

import { revalidatePath } from "next/cache";
import { hasPermission, isSessionScoreReadOnly } from "../permissions";
import { createSupabaseServerClient, getCurrentProfile } from "../supabase/server";

type MiniGameGoalInput = {
  scorerId?: string;
  assistPlayerId?: string;
  goalCount?: number;
  goalType?: "goal" | "own_goal";
};

type MiniGameInput = {
  matchNumber: number;
  displayOrder?: number;
  teamAId: string;
  teamBId: string;
  awayTeamId?: string;
  resultStatus?: "scheduled" | "played";
  scheduledStartTime?: string;
  scheduledEndTime?: string;
  goals?: MiniGameGoalInput[];
};

type FixtureTeam = {
  id: string;
};

type FixtureGameInput = {
  matchNumber: number;
  displayOrder?: number;
  teamAId: string;
  teamBId: string;
  awayTeamId?: string;
  scheduledStartTime?: string;
  scheduledEndTime?: string;
};

export async function saveMiniGameScores(_: unknown, formData: FormData) {
  try {
    const profile = await getCurrentProfile();
    if (!hasPermission(profile?.role, "manage_attendance")) return { error: "Only captains and admins can save game scores." };

    const sessionId = String(formData.get("sessionId") ?? "");
    const games = JSON.parse(String(formData.get("gamesJson") ?? "[]")) as MiniGameInput[];
    if (!sessionId) return { error: "Session is missing." };
    if (!Array.isArray(games)) return { error: "Game score data is invalid." };

    const supabase = await createSupabaseServerClient();
    const lockError = await lockedSessionError(supabase, sessionId, profile?.role);
    if (lockError) return { error: lockError };

    const seenMatchNumbers = new Set<number>();
    const requestedMatchNumbers = games
      .map((game) => Number(game.matchNumber))
      .filter((matchNumber) => Number.isFinite(matchNumber) && matchNumber > 0);

    const { data: existingMatches, error: existingError } = await supabase
      .from("session_matches")
      .select("id,match_number")
      .eq("session_id", sessionId);
    if (existingError) throw new Error(existingError.message);

    const { data: teamPlayers, error: teamPlayersError } = await supabase
      .from("session_team_players")
      .select("session_team_id,player_id")
      .eq("session_id", sessionId);
    if (teamPlayersError) throw new Error(teamPlayersError.message);

    const playerTeamIds = new Map((teamPlayers ?? []).map((row) => [String(row.player_id), String(row.session_team_id)]));
    let savedGames = 0;

    const { error: orphanGoalError } = await supabase
      .from("goals")
      .delete()
      .eq("session_id", sessionId)
      .is("match_id", null)
      .is("session_team_id", null);
    if (orphanGoalError) throw new Error(orphanGoalError.message);

    const removedMatchIds = (existingMatches ?? [])
      .filter((match) => !requestedMatchNumbers.includes(Number(match.match_number)))
      .map((match) => match.id);
    if (removedMatchIds.length) {
      const { error: deleteGoalError } = await supabase.from("goals").delete().in("match_id", removedMatchIds);
      if (deleteGoalError) throw new Error(deleteGoalError.message);
      const { error: deleteMatchError } = await supabase.from("session_matches").delete().in("id", removedMatchIds);
      if (deleteMatchError) throw new Error(deleteMatchError.message);
    }

    for (const game of games) {
      const matchNumber = Number(game.matchNumber);
      if (!Number.isFinite(matchNumber) || matchNumber <= 0) continue;
      if (!game.teamAId || !game.teamBId || game.teamAId === game.teamBId) continue;
      if (seenMatchNumbers.has(matchNumber)) continue;
      seenMatchNumbers.add(matchNumber);
      const awayTeamId = game.awayTeamId === game.teamAId || game.awayTeamId === game.teamBId ? game.awayTeamId : null;

      const normalizedGoals = normalizeMiniGameGoals(game, playerTeamIds);
      const resultStatus = game.resultStatus === "played" || normalizedGoals.length > 0 ? "played" : "scheduled";
      const teamAScore = normalizedGoals
        .filter((goal) => goal.session_team_id === game.teamAId)
        .reduce((total, goal) => total + goal.goal_count, 0);
      const teamBScore = normalizedGoals
        .filter((goal) => goal.session_team_id === game.teamBId)
        .reduce((total, goal) => total + goal.goal_count, 0);

      const { data: match, error } = await supabase
        .from("session_matches")
        .upsert(
          {
            session_id: sessionId,
            match_number: matchNumber,
            display_order: Number.isFinite(Number(game.displayOrder)) && Number(game.displayOrder) > 0 ? Number(game.displayOrder) : matchNumber,
            team_a_id: game.teamAId,
            team_b_id: game.teamBId,
            away_team_id: awayTeamId,
            scheduled_start_time: validTimeOrNull(game.scheduledStartTime),
            scheduled_end_time: validTimeOrNull(game.scheduledEndTime),
            result_status: resultStatus,
            team_a_score: teamAScore,
            team_b_score: teamBScore,
            created_by: profile.id
          },
          { onConflict: "session_id,match_number" }
        )
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      const { error: deleteError } = await supabase.from("goals").delete().eq("session_id", sessionId).eq("match_id", match.id);
      if (deleteError) throw new Error(deleteError.message);

      const goalRows = normalizedGoals
        .map((goal) => ({
          session_id: sessionId,
          match_id: match.id,
          scorer_id: goal.scorerId,
          assist_player_id: goal.assist_player_id,
          session_team_id: goal.session_team_id,
          goal_type: goal.goal_type,
          goal_count: goal.goal_count,
          notes: goal.goal_type === "own_goal" ? "Own goal" : null,
          created_by: profile.id
        }));
      if (goalRows.length) {
        const { error: goalError } = await supabase.from("goals").insert(goalRows);
        if (goalError) throw new Error(goalError.message);
      }
      savedGames += 1;
    }

    if (!savedGames) return { error: "No valid games were saved. Select two different teams for at least one game." };

    revalidateSessionViews(sessionId);
    return { success: true, message: "Game scores saved." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save game scores." };
  }
}

export async function savePublicGameScores(_: unknown, formData: FormData) {
  try {
    const sessionId = String(formData.get("sessionId") ?? "");
    const games = JSON.parse(String(formData.get("gamesJson") ?? "[]")) as MiniGameInput[];
    if (!sessionId) return { error: "Session is missing." };
    if (!Array.isArray(games)) return { error: "Game score data is invalid." };

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("public_save_game_scores", {
      p_games: games,
      p_session_id: sessionId
    });
    if (error) throw new Error(error.message);
    if (data && typeof data === "object" && "error" in data) return { error: String(data.error) };

    revalidateSessionViews(sessionId);
    return { success: true, message: "Game scores saved." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save game scores." };
  }
}

export async function saveSessionFixture(_: unknown, formData: FormData) {
  try {
    const profile = await getCurrentProfile();
    if (!hasPermission(profile?.role, "manage_attendance")) return { error: "Only captains and admins can save fixtures." };

    const sessionId = String(formData.get("sessionId") ?? "");
    const games = JSON.parse(String(formData.get("gamesJson") ?? "[]")) as FixtureGameInput[];
    if (!sessionId) return { error: "Session is missing." };
    if (!Array.isArray(games)) return { error: "Fixture data is invalid." };

    const supabase = await createSupabaseServerClient();
    const lockError = await lockedSessionError(supabase, sessionId, profile?.role);
    if (lockError) return { error: lockError.replace("Scores", "Fixtures") };

    const [{ data: teams, error: teamsError }, { data: playedMatches, error: playedError }] = await Promise.all([
      supabase.from("session_teams").select("id").eq("session_id", sessionId),
      supabase.from("session_matches").select("id").eq("session_id", sessionId).eq("result_status", "played").limit(1)
    ]);
    if (teamsError) throw new Error(teamsError.message);
    if (playedError) throw new Error(playedError.message);
    if (!teams || teams.length < 2) return { error: "Create at least two teams before saving fixtures." };
    if (playedMatches?.length) return { error: "Fixture cannot be changed after game scores have been saved." };

    const teamIds = new Set(teams.map((team) => String(team.id)));
    const rows = [];
    for (const [index, game] of games.entries()) {
      const matchNumber = Number(game.matchNumber || index + 1);
      const teamAId = String(game.teamAId ?? "");
      const teamBId = String(game.teamBId ?? "");
      const awayTeamId = game.awayTeamId === teamAId || game.awayTeamId === teamBId ? game.awayTeamId : null;
      if (!Number.isFinite(matchNumber) || matchNumber <= 0) continue;
      if (!teamIds.has(teamAId) || !teamIds.has(teamBId) || teamAId === teamBId) continue;
      rows.push({
        session_id: sessionId,
        match_number: matchNumber,
        display_order: index + 1,
        team_a_id: teamAId,
        team_b_id: teamBId,
        away_team_id: awayTeamId,
        scheduled_start_time: validTimeOrNull(game.scheduledStartTime),
        scheduled_end_time: validTimeOrNull(game.scheduledEndTime),
        result_status: "scheduled",
        team_a_score: 0,
        team_b_score: 0,
        created_by: profile.id
      });
    }

    if (!rows.length) return { error: "No valid fixture games were saved." };

    const { data: existingMatches, error: existingError } = await supabase
      .from("session_matches")
      .select("id")
      .eq("session_id", sessionId);
    if (existingError) throw new Error(existingError.message);

    const existingMatchIds = (existingMatches ?? []).map((match) => match.id);
    if (existingMatchIds.length) {
      const { error: deleteGoalsError } = await supabase.from("goals").delete().in("match_id", existingMatchIds);
      if (deleteGoalsError) throw new Error(deleteGoalsError.message);
      const { error: deleteMatchesError } = await supabase.from("session_matches").delete().in("id", existingMatchIds);
      if (deleteMatchesError) throw new Error(deleteMatchesError.message);
    }

    const { error: insertError } = await supabase.from("session_matches").insert(rows);
    if (insertError) throw new Error(insertError.message);

    revalidateSessionViews(sessionId);
    return { success: true, message: "Fixture saved." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save fixture." };
  }
}

export async function generateSessionFixture(_: unknown, formData: FormData) {
  try {
    const profile = await getCurrentProfile();
    if (!hasPermission(profile?.role, "manage_attendance")) return { error: "Only captains and admins can generate fixtures." };

    const sessionId = String(formData.get("sessionId") ?? "");
    const avoidFirstTeamId = String(formData.get("avoidFirstTeamId") ?? "");
    const repeats = Math.max(1, Number(formData.get("repeatMatchups") ?? 1) || 1);
    const breakAfterGames = Math.max(0, Number(formData.get("breakAfterGames") ?? 0) || 0);
    const breakLengthMinutes = Math.max(0, Number(formData.get("breakLengthMinutes") ?? 0) || 0);
    const firstSegmentMinutes = Math.max(1, Number(formData.get("firstSegmentMinutes") ?? 1) || 1);
    const secondSegmentMinutes = Math.max(1, Number(formData.get("secondSegmentMinutes") ?? 1) || 1);
    if (!sessionId) return { error: "Session is missing." };

    const supabase = await createSupabaseServerClient();
    const lockError = await lockedSessionError(supabase, sessionId, profile?.role);
    if (lockError) return { error: lockError.replace("Scores", "Fixtures") };

    const [{ data: session, error: sessionError }, { data: teams, error: teamsError }, { data: playedMatches, error: matchesError }] = await Promise.all([
      supabase.from("sessions").select("start_time").eq("id", sessionId).maybeSingle(),
      supabase.from("session_teams").select("id").eq("session_id", sessionId).order("name"),
      supabase.from("session_matches").select("id").eq("session_id", sessionId).eq("result_status", "played").limit(1)
    ]);
    if (sessionError) throw new Error(sessionError.message);
    if (teamsError) throw new Error(teamsError.message);
    if (matchesError) throw new Error(matchesError.message);
    if (!session) return { error: "Session was not found." };
    if (!teams || teams.length < 2) return { error: "Create at least two teams before generating fixtures." };
    if (playedMatches?.length) return { error: "Fixture cannot be regenerated after game scores have been saved." };

    const pairings = generatePairings(teams, repeats, avoidFirstTeamId);
    const timedGames = applyFixtureTimes(
      pairings.map((pairing, index) => ({
        matchNumber: index + 1,
        displayOrder: index + 1,
        teamAId: pairing.teamAId,
        teamBId: pairing.teamBId,
        awayTeamId: pairing.teamBId
      })),
      {
        breakAfterGames,
        breakLengthMinutes,
        firstSegmentMinutes,
        secondSegmentMinutes,
        sessionStartTime: session.start_time
      }
    );

    const { data: existingMatches, error: existingError } = await supabase
      .from("session_matches")
      .select("id")
      .eq("session_id", sessionId);
    if (existingError) throw new Error(existingError.message);

    const existingMatchIds = (existingMatches ?? []).map((match) => match.id);
    if (existingMatchIds.length) {
      const { error: deleteGoalsError } = await supabase.from("goals").delete().in("match_id", existingMatchIds);
      if (deleteGoalsError) throw new Error(deleteGoalsError.message);
      const { error: deleteMatchesError } = await supabase.from("session_matches").delete().in("id", existingMatchIds);
      if (deleteMatchesError) throw new Error(deleteMatchesError.message);
    }

    const rows = timedGames.map((game) => ({
      session_id: sessionId,
      match_number: game.matchNumber,
      display_order: game.displayOrder,
      team_a_id: game.teamAId,
      team_b_id: game.teamBId,
      away_team_id: game.awayTeamId,
      scheduled_start_time: validTimeOrNull(game.scheduledStartTime),
      scheduled_end_time: validTimeOrNull(game.scheduledEndTime),
      result_status: "scheduled",
      team_a_score: 0,
      team_b_score: 0,
      created_by: profile.id
    }));

    const { error: insertError } = await supabase.from("session_matches").insert(rows);
    if (insertError) throw new Error(insertError.message);

    revalidateSessionViews(sessionId);
    return { success: true, message: "Fixture generated." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not generate fixture." };
  }
}

async function lockedSessionError(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, sessionId: string, role: Parameters<typeof isSessionScoreReadOnly>[0]) {
  const { data: session, error } = await supabase
    .from("sessions")
    .select("session_date,status")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!session) return "Session was not found.";
  if (isSessionScoreReadOnly(role, session, currentTorontoDate())) {
    return "Scores are read-only because this session is completed or past its date.";
  }
  return null;
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

function validTimeOrNull(value?: string | null) {
  const text = String(value ?? "");
  return /^\d{2}:\d{2}(:\d{2})?$/.test(text) ? text : null;
}

function revalidateSessionViews(sessionId: string) {
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath(`/sessions/${sessionId}/fixture`);
  revalidatePath(`/sessions/${sessionId}/scores`);
  revalidatePath(`/public/sessions/${sessionId}`);
  revalidatePath(`/public/sessions/${sessionId}/summary`);
  revalidatePath(`/public/sessions/${sessionId}/scores`);
  revalidatePath("/reports/leaderboards");
  revalidatePath("/public/leaderboards");
  revalidatePath("/reports/stats");
  revalidatePath("/public/report");
}

function generatePairings(teams: FixtureTeam[], repeats: number, avoidFirstTeamId: string) {
  const basePairs: Array<{ teamAId: string; teamBId: string }> = [];
  for (let left = 0; left < teams.length; left += 1) {
    for (let right = left + 1; right < teams.length; right += 1) {
      basePairs.push({ teamAId: teams[left].id, teamBId: teams[right].id });
    }
  }

  if (avoidFirstTeamId) {
    const preferredIndex = basePairs.findIndex((pair) => pair.teamAId !== avoidFirstTeamId && pair.teamBId !== avoidFirstTeamId);
    if (preferredIndex > 0) {
      const [preferred] = basePairs.splice(preferredIndex, 1);
      basePairs.unshift(preferred);
    }
  }

  const pairings: Array<{ teamAId: string; teamBId: string }> = [];
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    for (const pair of basePairs) {
      pairings.push(repeat % 2 === 0 ? pair : { teamAId: pair.teamBId, teamBId: pair.teamAId });
    }
  }
  return pairings;
}

function applyFixtureTimes(
  rows: Array<{
    matchNumber: number;
    displayOrder: number;
    teamAId: string;
    teamBId: string;
    awayTeamId: string;
  }>,
  options: {
    breakAfterGames: number;
    breakLengthMinutes: number;
    firstSegmentMinutes: number;
    secondSegmentMinutes: number;
    sessionStartTime?: string | null;
  }
) {
  const startMinutes = parseTimeToMinutes(options.sessionStartTime);
  if (startMinutes == null) {
    return rows.map((row) => ({ ...row, scheduledStartTime: "", scheduledEndTime: "" }));
  }

  let cursor = startMinutes;
  return rows.map((row, index) => {
    if (options.breakAfterGames > 0 && index === options.breakAfterGames) cursor += options.breakLengthMinutes;
    const duration = options.breakAfterGames > 0 && index >= options.breakAfterGames
      ? options.secondSegmentMinutes
      : options.firstSegmentMinutes;
    const scheduledStartTime = minutesToTime(cursor);
    cursor += duration;
    return {
      ...row,
      scheduledStartTime,
      scheduledEndTime: minutesToTime(cursor)
    };
  });
}

function parseTimeToMinutes(value?: string | null) {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function minutesToTime(value: number) {
  const minutesInDay = 24 * 60;
  const normalized = ((value % minutesInDay) + minutesInDay) % minutesInDay;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeMiniGameGoals(game: MiniGameInput, playerTeamIds: Map<string, string>) {
  return (game.goals ?? [])
    .map((goal) => {
      const scorerId = String(goal.scorerId ?? "");
      const goalType = goal.goalType === "own_goal" ? "own_goal" : "goal";
      const scorerTeamId = playerTeamIds.get(scorerId);
      const sessionTeamId = goalType === "own_goal"
        ? scorerTeamId === game.teamAId
          ? game.teamBId
          : scorerTeamId === game.teamBId
            ? game.teamAId
            : ""
        : scorerTeamId === game.teamAId || scorerTeamId === game.teamBId
          ? scorerTeamId
          : "";
      const assistPlayerId = goalType === "own_goal" ? "" : String(goal.assistPlayerId ?? "");
      const assistTeamId = assistPlayerId ? playerTeamIds.get(assistPlayerId) : undefined;
      return {
        scorerId,
        assist_player_id: assistTeamId === scorerTeamId ? assistPlayerId : null,
        session_team_id: sessionTeamId || null,
        goal_type: goalType,
        goal_count: Math.max(1, Number(goal.goalCount ?? 1) || 1)
      };
    })
    .filter((goal) => goal.scorerId && goal.session_team_id);
}

export async function saveTeamLineup(_: unknown, formData: FormData) {
  try {
    const profile = await getCurrentProfile();
    if (!profile?.player_id) return { error: "Your account must be linked to a player profile before you can save a lineup." };

    const sessionId = String(formData.get("sessionId") ?? "");
    const sessionTeamId = String(formData.get("sessionTeamId") ?? "");
    const playerCount = Math.max(1, Number(formData.get("playerCount") ?? 0) || 0);
    const formation = String(formData.get("formation") ?? "");
    const positions = JSON.parse(String(formData.get("positionsJson") ?? "[]"));
    if (!sessionId || !sessionTeamId) return { error: "Session and team are required." };
    if (!Array.isArray(positions)) return { error: "Lineup positions are invalid." };

    const supabase = await createSupabaseServerClient();
    const { data: teamPlayer, error: teamPlayerError } = await supabase
      .from("session_team_players")
      .select("id")
      .eq("session_id", sessionId)
      .eq("session_team_id", sessionTeamId)
      .eq("player_id", profile.player_id)
      .maybeSingle();
    if (teamPlayerError) throw new Error(teamPlayerError.message);
    if (!teamPlayer) return { error: "Only players assigned to this team can save its lineup." };

    const { error } = await supabase.from("session_team_lineups").upsert(
      {
        session_id: sessionId,
        session_team_id: sessionTeamId,
        player_count: playerCount,
        formation,
        positions,
        created_by: profile.id
      },
      { onConflict: "session_team_id" }
    );
    if (error) throw new Error(error.message);

    revalidatePath(`/sessions/${sessionId}`);
    revalidatePath(`/sessions/${sessionId}/lineups`);
    return { success: true, message: "Lineup saved." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save lineup." };
  }
}

export async function linkCaptainPlayerProfile(_: unknown, formData: FormData) {
  try {
    const profile = await getCurrentProfile();
    if (profile?.role !== "captain") return { error: "Only captain accounts can link a player profile here." };
    if (profile.player_id) return { error: "This captain account is already linked to a player profile." };

    const playerId = String(formData.get("playerId") ?? "");
    const sessionId = String(formData.get("sessionId") ?? "");
    if (!playerId) return { error: "Choose the player profile that belongs to you." };

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("link_current_captain_player_profile", { p_player_id: playerId });
    if (error) throw new Error(error.message);

    if (sessionId) revalidatePath(`/sessions/${sessionId}/lineups`);
    return { success: true, message: "Captain profile linked. You can now manage your team lineup." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not link captain profile." };
  }
}
