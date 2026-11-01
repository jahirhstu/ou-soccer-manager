import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { Player } from "@/lib/types";
import { goalkeeperSelectionForGoal, matchPositionEntries, scorePositionEntries } from "@/lib/performance-position";

const mocks = vi.hoisted(() => ({ from: vi.fn(), profile: vi.fn() }));
const pageQueries: any[] = [];
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ from: mocks.from }),
  getCurrentProfile: mocks.profile
}));
vi.mock("next/link", () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }));
vi.mock("../../app/(shell)", () => ({ AppShell: ({ children }: any) => <main>{children}</main> }));
vi.mock("@/components/DataTable", () => ({
  DataTable: ({ columns, rows, empty }: any) => rows.length
    ? <div>{rows.map((row: Player) => <article key={row.id}>{columns.map((column: any) => <div key={column.header}>{column.cell(row)}</div>)}</article>)}</div>
    : <p>{empty}</p>
}));
vi.mock("@/components/StatusBadge", () => ({ StatusBadge: ({ status }: any) => <span>{status}</span> }));
vi.mock("@/components/EditablePlayerField", () => ({
  EditablePlayerField: ({ field, playerName, value }: any) => <button aria-label={`Edit ${field} for ${playerName}`}>{value ?? `Add ${field}`}</button>
}));
vi.mock("@/lib/actions/session-management", () => ({ saveMiniGameScores: vi.fn() }));
vi.mock("@/lib/actions/performance", () => ({ updatePerformance: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import PlayersPage from "../../app/players/page";
import { MiniGameScoresForm, type MatchInput } from "../../components/MiniGameScoresForm";
import { SessionPerformance } from "../../components/SessionPerformance";
import { SessionNominations } from "../../components/SessionNominations";

const players: Player[] = Array.from({ length: 501 }, (_, index) => ({
  id: `player-${String(index).padStart(3, "0")}`,
  display_name: `Player ${String(index).padStart(3, "0")}`,
  phone: null,
  email: null,
  status: "active",
  preferred_position: index === 500 ? null : "midfielder",
  notes: null
}));

beforeEach(() => {
  vi.clearAllMocks();
  pageQueries.length = 0;
  mocks.profile.mockResolvedValue({ role: "admin", organization_id: "org" });
  mocks.from.mockImplementation((table: string) => {
    if (table !== "players") throw new Error(`Unexpected table: ${table}`);
    let start = 0;
    let end = 499;
    const query: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn((first: number, last: number) => { start = first; end = last; return query; }),
      then(resolve: (result: unknown) => unknown) {
        return Promise.resolve({ data: players.slice(start, end + 1), error: null }).then(resolve);
      }
    };
    pageQueries.push(query);
    return query;
  });
});

it("loads every organization player across API pages, including players without a default position", async () => {
  const html = renderToStaticMarkup(await PlayersPage({ searchParams: Promise.resolve({}) }));
  expect(mocks.from).toHaveBeenCalledTimes(2);
  expect(pageQueries[0].eq.mock.calls).toEqual([["organization_id", "org"]]);
  expect(pageQueries[0].range).toHaveBeenCalledWith(0, 499);
  expect(pageQueries[1].range).toHaveBeenCalledWith(500, 999);
  expect(html).toContain("Player 500");
  expect(html).toContain("Add preferred_position");
  expect(html).toContain('aria-label="Edit preferred_position for Player 500"');
});

it("offers the whole opposing roster and auto-selects its first resolved, participating goalkeeper", () => {
  const teams = [
    { id: "a", players: [{ id: "scorer", name: "Scorer" }] },
    { id: "b", players: [
      { id: "z-keeper", name: "Z Keeper" },
      { id: "defender", name: "Defender" },
      { id: "a-keeper", name: "A Keeper" }
    ] }
  ];
  const positions = [
    { match_id: "match", player_id: "z-keeper", session_team_id: "b", position: "goalkeeper", participated: true },
    { match_id: "match", player_id: "a-keeper", session_team_id: "b", position: "goalkeeper", participated: true },
    { match_id: "match", player_id: "defender", session_team_id: "b", position: "defender", participated: true }
  ];
  const selection = goalkeeperSelectionForGoal(teams, positions, "match", "scorer", "goal", "a", "b");
  expect(selection.players.map((player) => player.id)).toEqual(["a-keeper", "defender", "z-keeper"]);
  expect(selection.suggestedGoalkeeperId).toBe("a-keeper");
});

it("keeps every opposing player manually selectable when no goalkeeper position is resolved", () => {
  const teams = [
    { id: "a", players: [{ id: "scorer", name: "Scorer" }] },
    { id: "b", players: [{ id: "one", name: "One" }, { id: "two", name: "Two" }] }
  ];
  const selection = goalkeeperSelectionForGoal(teams, [], "match", "scorer", "goal", "a", "b");
  expect(selection.players.map((player) => player.id)).toEqual(["one", "two"]);
  expect(selection.suggestedGoalkeeperId).toBe("");
  expect(goalkeeperSelectionForGoal(teams, [], "match", "one", "goal", "a", "b").players.map((player) => player.id)).toEqual(["scorer"]);
});

it("persists only positions explicitly selected in game scoring", () => {
  expect(scorePositionEntries([
    { scorerId: "player-a", position: undefined },
    { scorerId: "player-b", position: "defender" },
    { scorerId: "player-c", position: "" }
  ])).toEqual([{ playerId: "player-b", position: "defender" }]);
});

it("submits only changed positions and never sends a conceding goalkeeper demotion", () => {
  expect(matchPositionEntries([
    { playerId: "keeper", position: "goalkeeper", resolvedPosition: "goalkeeper", participated: true, goalkeeperAssigned: true },
    { playerId: "defender", position: "midfielder", resolvedPosition: "defender", participated: true },
    { playerId: "unchanged", position: "forward", resolvedPosition: "forward", participated: true }
  ])).toEqual([{ playerId: "defender", position: "midfielder", participated: true }]);
  expect(matchPositionEntries([
    { playerId: "keeper", position: "defender", resolvedPosition: "goalkeeper", participated: true, goalkeeperAssigned: true }
  ])).toEqual([]);
});

it("renders all opposing goalkeeper candidates and selects the first resolved keeper", () => {
  const teams = [
    { id: "a", name: "Team A", players: [{ id: "scorer", name: "Scorer" }] },
    { id: "b", name: "Team B", players: [{ id: "keeper", name: "Keeper" }, { id: "defender", name: "Defender" }] }
  ];
  const positions = [
    { match_id: "match", player_id: "keeper", session_team_id: "b", position: "goalkeeper", participated: true },
    { match_id: "match", player_id: "defender", session_team_id: "b", position: "defender", participated: true }
  ];
  const game: MatchInput = {
    key: "match",
    matchNumber: 1,
    teamAId: "a",
    teamBId: "b",
    goals: [{ key: "goal", scorerId: "scorer", assistPlayerId: "", goalType: "goal", goalCount: 1 }]
  };
  const html = renderToStaticMarkup(<MiniGameScoresForm
    existingGames={[game]}
    positions={positions}
    readOnly
    sessionId="session"
    teams={teams}
  />);
  const goalkeeperSelect = html.slice(html.indexOf("Goalkeeper conceded"), html.indexOf("</label>", html.indexOf("Goalkeeper conceded")));
  expect(goalkeeperSelect).toContain('value="keeper" selected=""');
  expect(goalkeeperSelect).toContain('value="defender"');
});

it("does not promote a resolved fallback to a confirmed match-position override", () => {
  const html = renderToStaticMarkup(<SessionPerformance data={{
    session: { id: "session", name: "Session", status: "draft", seasonId: "season" },
    canManage: true,
    canClose: false,
    closed: false,
    teams: [
      { id: "a", name: "A", canVote: false, players: [{ id: "player", name: "Player" }] },
      { id: "b", name: "B", canVote: false, players: [{ id: "opponent", name: "Opponent" }] }
    ],
    matches: [{ id: "match", number: 1, teamAId: "a", teamBId: "b", teamAName: "A", teamBName: "B", status: "played" }],
    positions: [{
      match_id: "match", player_id: "player", session_team_id: "a",
      position: "goalkeeper", confirmed_position: null, score_position: null, participated: true,
      goalkeeper_assigned: true
    }],
    details: [],
    votes: [],
    awards: [],
    results: []
  }} />);
  expect(html).toContain('value="goalkeeper" selected="">Goalkeeper (Resolved)</option>');
  expect(html).not.toContain("Use resolved position");
  expect(html).toContain("recorded as the goalkeeper who conceded a goal");
});

it("shows player nominations with a 20 point maximum and excludes only the voter's own profile", () => {
  const html = renderToStaticMarkup(<SessionNominations data={{
    session: { id: "session", name: "Session", status: "completed", seasonId: "season" },
    canManage: false,
    canClose: false,
    canNominate: true,
    voterPlayerId: "voter",
    closed: false,
    teams: [],
    matches: [],
    positions: [],
    details: [
      { player_id: "voter", player_name: "Voter", match_number: 1, position: "goalkeeper", keeper_conceded: null, clean_sheet: false, breakdown: {} },
      { player_id: "teammate", player_name: "Voter Teammate", match_number: 1, position: "goalkeeper", keeper_conceded: null, clean_sheet: false, breakdown: {} },
      { player_id: "defender", player_name: "Defender", match_number: 1, position: "defender", keeper_conceded: null, clean_sheet: false, breakdown: {} },
      { player_id: "midfielder", player_name: "Midfielder", match_number: 1, position: "midfielder", keeper_conceded: null, clean_sheet: false, breakdown: {} }
    ],
    votes: [],
    awards: [],
    results: []
  }} />);
  expect(html).toContain("Maximum casting point is 20 per nomination");
  expect(html).toContain("Top Goalkeeper");
  expect(html).toContain("Top Defender");
  expect(html).toContain("Top Midfielder");
  expect(html).toContain("Voter Teammate");
  expect(html).not.toContain('value="voter"');
  expect(html).not.toContain("Captain nominations");
});
