import { expect, it } from "vitest";
import { buildSessionStandings, sessionSummary } from "../../packages/contracts/src";

const teams = [
  { id: "a", name: "Alpha", players: [{ id: "p1", name: "Alex" }, { id: "p2", name: "Sam" }] },
  { id: "b", name: "Beta", players: [{ id: "p3", name: "Alex" }] },
];
const game = { teamAId: "a", teamBId: "b", awayTeamId: "b", resultStatus: "played", goals: [] };

it("counts a scoreless played match but not an unplayed fixture", () => {
  const result = sessionSummary(teams, [game, { ...game, resultStatus: "scheduled" }]);
  expect(result.played).toBe(1);
  expect(result.standings.map((team) => [team.played, team.points, team.draws])).toEqual([[1, 1, 1], [1, 1, 1]]);
  expect(result.contributions).toEqual([]);
});
it("credits own goals to the opponent and separates players with identical names", () => {
  const result = sessionSummary(teams, [{ ...game, goals: [
    { scorerId: "p1", assistPlayerId: "p2", goalCount: 2, goalType: "goal" },
    { scorerId: "p3", goalCount: 1, goalType: "goal" },
    { scorerId: "p1", assistPlayerId: "p2", goalCount: 1, goalType: "own_goal" },
  ] }]);
  expect(result.standings.every((team) => team.goalsFor === 2 && team.points === 1)).toBe(true);
  expect(result.contributions).toHaveLength(3);
  expect(result.contributions.find((player) => player.id === "p1")?.goals).toBe(2);
  expect(result.contributions.find((player) => player.id === "p2")).toMatchObject({ goals: 0, assists: 2 });
  expect(result.contributions.find((player) => player.id === "p3")?.goals).toBe(1);
});
it("uses the website's shared points, goal difference, goals, away-goals ordering", () => {
  const rows = buildSessionStandings([
    { teamAId: "a", teamBId: "b", teamAName: "Alpha", teamBName: "Beta", teamAScore: 2, teamBScore: 2, awayTeamId: "b", resultStatus: "played" },
  ]);
  expect(rows[0]).toMatchObject({ teamId: "b", rank: 1, awayGoals: 2 });
  expect(rows[1]).toMatchObject({ teamId: "a", rank: 2, awayGoals: 0 });
});
it("does not publish unsaved or scheduled goal contributions", () => {
  const result = sessionSummary(teams, [{ ...game, resultStatus: "scheduled", goals: [{ scorerId: "p1", goalType: "goal", goalCount: 3 }] }]);
  expect(result.contributions).toEqual([]);
  expect(result.standings.every((team) => team.points === 0)).toBe(true);
});
it("handles empty sessions and unresolved final fixtures", () => {
  expect(sessionSummary([], []).standings).toEqual([]);
  expect(sessionSummary(teams, [{ ...game, teamBId: undefined }]).standings).toEqual([]);
});
