import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import type { PerformanceData } from "../../packages/contracts/src/performance";
import { previousMatchPositions } from "../../packages/contracts/src/performance";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/performance", () => ({ updatePerformance: vi.fn() }));
import { SessionPerformance } from "../../components/SessionPerformance";

const data: PerformanceData = {
  session: { id: "session", name: "Sunday morning", status: "completed", seasonId: "fall" },
  canManage: true, canClose: true, closed: false,
  teams: [
    { id: "a", name: "Team Sadat", canVote: true, players: [{ id: "a1", name: "Own Goalkeeper" }, { id: "a2", name: "Own Defender" }] },
    { id: "b", name: "Team Jahir", canVote: false, players: [{ id: "b1", name: "Visiting Goalkeeper" }, { id: "b2", name: "Visiting Midfielder" }] },
  ],
  matches: [{ id: "g1", number: 1, teamAId: "a", teamBId: "b", teamAName: "Team Sadat", teamBName: "Team Jahir", status: "played" }],
  positions: [], votes: [],
  awards: [{ category: "goalkeeper", player_id: "a1", player_name: "Own Goalkeeper", nominations: 1 }, { category: "goalkeeper", player_id: "b1", player_name: "Visiting Goalkeeper", nominations: 1 }],
  details: [
    { player_id: "a1", player_name: "Own Goalkeeper", match_number: 1, position: "goalkeeper", keeper_conceded: 0, clean_sheet: true, breakdown: { rating: 7, defense: 4 } },
    { player_id: "b1", player_name: "Visiting Goalkeeper", match_number: 1, position: "goalkeeper", keeper_conceded: null, clean_sheet: false, breakdown: { rating: 5, defense: 0 } },
  ],
  results: [{ player_id: "a1", player_name: "Own Goalkeeper", matches_played: 4, rated_matches: 4, positions: ["goalkeeper"], match_points: 28, captain_points: 30, final_rating: 58, incomplete: false }],
};

it("renders tied awards, point breakdowns and only opposing eligible nominees", () => {
  const html = renderToStaticMarkup(<SessionPerformance data={data} />);
  expect(html).toContain("58.00");
  expect(html).toContain("Match 28.00/40");
  expect(html).toContain('value="b1"');
  expect(html).not.toContain('<option value="a1"');
  expect(html).not.toContain('<option value="b2"');
  expect(html).not.toContain('checked=""');
  expect(html).toContain("Own Goalkeeper");
  expect(html).toContain("Visiting Goalkeeper");
  expect(html).toContain("Team Sadat vs Team Jahir");
  expect(html).not.toContain("Played</label>");
  if (process.env.OU_RENDER_PERFORMANCE === "1") {
    const css = readdirSync(".next/static/css").filter(f => f.endsWith(".css")).map(f => readFileSync(`.next/static/css/${f}`, "utf8")).join("\n");
    writeFileSync("/tmp/ou-performance-preview.html", `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main style="max-width:1100px;margin:auto;padding:16px"><h1 class="page-title">Player performance</h1>${html}</main></body></html>`);
  }
});

it("hides writes for spectators and ballots when voting is closed", () => {
  const html = renderToStaticMarkup(<SessionPerformance data={{ ...data, canManage: false, canClose: false, closed: true }} />);
  expect(html).not.toContain("Confirm match participation");
  expect(html).not.toContain("Save nomination");
  expect(html).not.toContain("Reopen voting");
  expect(html).toContain("Voting closed");
});

it("keeps zero-participation sessions empty without assigning ratings", () => {
  const html = renderToStaticMarkup(<SessionPerformance data={{ ...data, canManage: false, results: [], details: [], awards: [] }} />);
  expect(html).toContain("No confirmed participation");
  expect(html).toContain("No nominations");
});

it("copies only earlier confirmed positions for the current match roster", () => {
  const fixture: PerformanceData = { ...data, matches: [data.matches[0], { ...data.matches[0], id: "g2", number: 2 }], positions: [
    { match_id: "g1", player_id: "a1", session_team_id: "a", position: "goalkeeper", participated: true },
    { match_id: "g2", player_id: "a1", session_team_id: "a", position: "forward", participated: true },
    { match_id: "g1", player_id: "not-on-roster", session_team_id: "a", position: "midfielder", participated: true }
  ] };
  expect(previousMatchPositions(fixture, "g1")).toEqual({});
  expect(previousMatchPositions(fixture, "g2")).toEqual({ "g2:a1": { position: "goalkeeper", participated: true } });
});
