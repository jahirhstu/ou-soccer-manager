export type PerformanceTeam = {
  id: string;
  players: Array<{ id: string; name: string }>;
};

export function updateScoringGoalPosition<T extends { key: string; position?: string }>(
  goals: T[],
  goalKey: string,
  position: string
) {
  return goals.map((goal) => goal.key === goalKey ? { ...goal, position } : goal);
}

export function goalkeeperSelectionForGoal(
  teams: PerformanceTeam[],
  scorerId: string,
  goalType: "goal" | "own_goal",
  teamAId?: string,
  teamBId?: string
) {
  const scorerTeam = teams.find((team) => team.players.some((player) => player.id === scorerId));
  if (!scorerTeam || !teamAId || !teamBId || teamAId === teamBId) {
    return { players: [] as Array<{ id: string; name: string }> };
  }

  const concededTeamId = goalType === "own_goal"
    ? scorerTeam.id
    : scorerTeam.id === teamAId ? teamBId : scorerTeam.id === teamBId ? teamAId : "";
  const concededTeam = teams.find((team) => team.id === concededTeamId);
  if (!concededTeam) {
    return { players: [] as Array<{ id: string; name: string }> };
  }

  const players = [...concededTeam.players].sort((left, right) =>
    left.name.localeCompare(right.name, "en", { sensitivity: "base" }) ||
    left.name.localeCompare(right.name, "en") ||
    left.id.localeCompare(right.id)
  );
  return { players };
}
