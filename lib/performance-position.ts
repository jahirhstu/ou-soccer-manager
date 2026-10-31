export type MatchPositionRow = {
  match_id: string;
  player_id: string;
  session_team_id: string;
  position: string | null;
  participated?: boolean;
};

export type PerformanceTeam = {
  id: string;
  players: Array<{ id: string; name: string }>;
};

type ScorePositionSelection = { scorerId: string; position?: string };

export function scorePositionEntries(goals: ScorePositionSelection[]) {
  return Array.from(new Map(goals
    .filter((goal): goal is ScorePositionSelection & { position: string } => Boolean(goal.scorerId && goal.position))
    .map((goal) => [goal.scorerId, { playerId: goal.scorerId, position: goal.position }])).values());
}

export function goalkeeperSelectionForGoal(
  teams: PerformanceTeam[],
  positions: MatchPositionRow[],
  matchId: string,
  scorerId: string,
  goalType: "goal" | "own_goal",
  teamAId?: string,
  teamBId?: string
) {
  const scorerTeam = teams.find((team) => team.players.some((player) => player.id === scorerId));
  if (!scorerTeam || !teamAId || !teamBId || teamAId === teamBId) {
    return { players: [] as Array<{ id: string; name: string }>, suggestedGoalkeeperId: "" };
  }

  const concededTeamId = goalType === "own_goal"
    ? scorerTeam.id
    : scorerTeam.id === teamAId ? teamBId : scorerTeam.id === teamBId ? teamAId : "";
  const concededTeam = teams.find((team) => team.id === concededTeamId);
  if (!concededTeam) {
    return { players: [] as Array<{ id: string; name: string }>, suggestedGoalkeeperId: "" };
  }

  const players = [...concededTeam.players].sort((left, right) =>
    left.name.localeCompare(right.name, "en", { sensitivity: "base" }) ||
    left.name.localeCompare(right.name, "en") ||
    left.id.localeCompare(right.id)
  );
  const suggestedGoalkeeperId = players.find((player) => {
    const position = positions.find((row) => row.match_id === matchId && row.player_id === player.id);
    return position?.position === "goalkeeper" && position.participated !== false;
  })?.id ?? "";
  return { players, suggestedGoalkeeperId };
}
