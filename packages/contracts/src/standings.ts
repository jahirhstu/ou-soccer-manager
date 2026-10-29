export type Standing = {
  teamId: string; teamName: string; played: number; wins: number; draws: number;
  losses: number; goalsFor: number; goalsAgainst: number; goalDifference: number;
  awayGoals: number; points: number; rank: number;
};
export type MatchRow = {
  teamAId?: string | null; teamBId?: string | null; teamAName?: string | null; teamBName?: string | null;
  teamAScore?: number | string | null; teamBScore?: number | string | null;
  resultStatus?: string | null; awayTeamId?: string | null;
};
export function buildSessionStandings(matches: MatchRow[]): Standing[] {
  const rows = new Map<string, Standing>();
  const ensure = (teamId: string, teamName: string) => {
    if (!rows.has(teamId)) {
      rows.set(teamId, {
        teamId,
        teamName,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        awayGoals: 0,
        points: 0,
        rank: 0
      });
    }
    return rows.get(teamId)!;
  };

  for (const match of matches) {
    if (!match.teamAId || !match.teamBId) continue;
    const teamA = ensure(match.teamAId, match.teamAName ?? "Team A");
    const teamB = ensure(match.teamBId, match.teamBName ?? "Team B");
    if (match.resultStatus !== "played") continue;
    applyResult(teamA, numberValue(match.teamAScore), numberValue(match.teamBScore), match.awayTeamId === match.teamAId);
    applyResult(teamB, numberValue(match.teamBScore), numberValue(match.teamAScore), match.awayTeamId === match.teamBId);
  }

  return Array.from(rows.values())
    .map((row) => ({ ...row, goalDifference: row.goalsFor - row.goalsAgainst }))
    .sort((left, right) =>
      right.points - left.points ||
      right.goalDifference - left.goalDifference ||
      right.goalsFor - left.goalsFor ||
      right.awayGoals - left.awayGoals ||
      left.teamName.localeCompare(right.teamName)
    )
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function applyResult(row: Standing, goalsFor: number, goalsAgainst: number, isAway = false) {
  row.played += 1;
  row.goalsFor += goalsFor;
  row.goalsAgainst += goalsAgainst;
  if (isAway) row.awayGoals += goalsFor;
  if (goalsFor > goalsAgainst) {
    row.wins += 1;
    row.points += 3;
  } else if (goalsFor === goalsAgainst) {
    row.draws += 1;
    row.points += 1;
  } else {
    row.losses += 1;
  }
}

function numberValue(value: number | string | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}
