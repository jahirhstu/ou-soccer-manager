import { buildSessionStandings } from "./standings";

type Team = { id: string; name: string; players: { id: string; name: string }[] };
type Goal = { scorerId: string; assistPlayerId?: string; goalCount: number; goalType: "goal" | "own_goal" };
type Game = { teamAId?: string; teamBId?: string; awayTeamId?: string; resultStatus: string; goals: Goal[] };

export function sessionSummary(teams: Team[], games: Game[]) {
  const players = new Map(teams.flatMap((team) => team.players.map((player) => [player.id, { ...player, teamId: team.id, teamName: team.name }] as const)));
  const contributions = new Map<string, { id: string; name: string; teamName: string; goals: number; assists: number }>();
  const contribute = (id: string | undefined, field: "goals" | "assists", count: number) => {
    const player = id ? players.get(id) : undefined;
    if (!player) return;
    const row = contributions.get(player.id) ?? { id: player.id, name: player.name, teamName: player.teamName, goals: 0, assists: 0 };
    row[field] += count;
    contributions.set(player.id, row);
  };
  const matches = games.map((game) => {
    let a = 0, b = 0;
    for (const goal of game.goals) {
      const player = players.get(goal.scorerId);
      if (!player || ![game.teamAId, game.teamBId].includes(player.teamId)) continue;
      const count = Math.max(1, goal.goalCount || 1);
      const scoringTeam = goal.goalType === "own_goal" ? (player.teamId === game.teamAId ? game.teamBId : game.teamAId) : player.teamId;
      if (scoringTeam === game.teamAId) a += count; else b += count;
      if (game.resultStatus === "played" && goal.goalType !== "own_goal") {
        contribute(goal.scorerId, "goals", count);
        contribute(goal.assistPlayerId, "assists", count);
      }
    }
    return { ...game, teamAScore: a, teamBScore: b,
      teamAName: teams.find((team) => team.id === game.teamAId)?.name,
      teamBName: teams.find((team) => team.id === game.teamBId)?.name };
  });
  return {
    standings: buildSessionStandings(matches),
    contributions: [...contributions.values()].sort((a, b) => b.goals - a.goals || b.assists - a.assists || a.name.localeCompare(b.name)),
    played: games.filter((game) => game.resultStatus === "played").length,
  };
}
