type Player = { id: string; name: string };
export type MatchPosition = { match_id: string; player_id: string; session_team_id: string; position: string | null; participated: boolean };
type Detail = { player_id: string; player_name: string; match_number: number; position: string | null; keeper_conceded: number | null; clean_sheet: boolean; breakdown: Record<string, number | null> };
export type PerformanceData = {
  session: { id: string; name: string; status: string; seasonId: string };
  canManage: boolean; canClose: boolean; closed: boolean;
  teams: { id: string; name: string; canVote: boolean; players: Player[] }[];
  matches: { id: string; number: number; teamAId: string; teamBId: string; status: string }[];
  positions: MatchPosition[];
  details: Detail[];
  votes: { captain_team_id: string; category: string; player_id: string }[];
  awards: { category: string; player_id: string; player_name: string; nominations: number }[];
  results: { player_id: string; player_name: string; matches_played: number; rated_matches: number; positions: string[]; match_points: number; captain_points: number; final_rating: number; incomplete: boolean }[];
};

export const matchPositions = ["goalkeeper", "defender", "midfielder", "forward"] as const;
export function previousMatchPositions(data: PerformanceData, matchId: string) {
  const match = data.matches.find(m => m.id === matchId);
  if (!match) return {};
  const roster = new Set(data.teams.filter(t => [match.teamAId, match.teamBId].includes(t.id)).flatMap(t => t.players.map(p => p.id)));
  const earlier = new Map(data.matches.filter(m => m.number < match.number).map(m => [m.id, m.number]));
  return Object.fromEntries(data.positions.filter(p => roster.has(p.player_id) && earlier.has(p.match_id))
    .sort((a, b) => earlier.get(a.match_id)! - earlier.get(b.match_id)!)
    .map(p => [`${matchId}:${p.player_id}`, { position: p.position ?? "", participated: p.participated }]));
}
export type SeasonPerformanceRow = { player_id: string; player_name: string; position: string; matches_played: number; sessions_played: number; average_match_rating: number; average_session_rating: number; nominations: number };
