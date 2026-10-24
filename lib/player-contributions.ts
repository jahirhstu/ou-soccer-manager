export type PlayerTotal = { playerName: string; teamNames: string; total: number };
export type PlayerContribution = { playerName: string; teamNames: string; goals: number; assists: number };

// The existing report identifies contributors by display name; keep that contract.
export function mergePlayerContributions(scorers: PlayerTotal[], assistants: PlayerTotal[]): PlayerContribution[] {
  const players = new Map<string, PlayerContribution>();
  for (const [field, rows] of [["goals", scorers], ["assists", assistants]] as const) {
    for (const row of rows) {
      if (row.total <= 0) continue;
      const player = players.get(row.playerName) ?? { playerName: row.playerName, teamNames: "", goals: 0, assists: 0 };
      player[field] += row.total;
      const teams = new Set([...player.teamNames.split(", "), ...row.teamNames.split(", ")].filter((name) => name && name !== "-"));
      player.teamNames = [...teams].sort((a, b) => a.localeCompare(b)).join(", ");
      players.set(row.playerName, player);
    }
  }
  return [...players.values()].map((row) => ({ ...row, teamNames: row.teamNames || "-" }))
    .sort((a, b) => b.goals - a.goals || b.assists - a.assists || a.playerName.localeCompare(b.playerName));
}
