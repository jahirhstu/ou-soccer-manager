import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import type { PerformanceData } from "../../packages/contracts/src/performance";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/performance", () => ({ updatePerformance: vi.fn() }));
import { SessionPerformance } from "../../components/SessionPerformance";
import { SessionNominations } from "../../components/SessionNominations";

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

it("renders rating breakdowns and teammate nomination choices while excluding the voter", () => {
  const ratings = renderToStaticMarkup(<SessionPerformance data={data} />);
  const nominations = renderToStaticMarkup(<SessionNominations data={{
    ...data,
    canManage: false,
    canClose: false,
    canNominate: true,
    voterPlayerId: "a1",
    nominations: [],
    voteCounts: [{ category: "goalkeeper", total: 3, pointsPerVote: 20 }]
  }} />);
  expect(ratings).toContain("58.00");
  expect(ratings).toContain("Match 28.00/40");
  expect(nominations).toContain("Top Goalkeeper");
  expect(nominations).toContain('value="b1"');
  expect(nominations).not.toContain('value="a1"');
  expect(nominations).toContain("Visiting Goalkeeper");
  expect(ratings).not.toContain("Match positions & participation");
  expect(ratings).toContain("Session ratings");
  expect(ratings).not.toContain("Played</label>");
  if (process.env.OU_RENDER_PERFORMANCE === "1") {
    const css = readdirSync(".next/static/css").filter(f => f.endsWith(".css")).map(f => readFileSync(`.next/static/css/${f}`, "utf8")).join("\n");
    writeFileSync("/tmp/ou-performance-preview.html", `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main style="max-width:1100px;margin:auto;padding:16px"><h1 class="page-title">Player performance</h1>${ratings}${nominations}</main></body></html>`);
  }
});

it("hides nomination writes when voting is closed", () => {
  const html = renderToStaticMarkup(<SessionNominations data={{
    ...data, canManage: false, canClose: false, canNominate: true, voterPlayerId: "a1",
    nominations: [], closed: true
  }} />);
  expect(html).not.toContain("Submit nomination");
  expect(html).not.toContain("Reopen nominations");
  expect(html).toContain("Nominations closed");
});

it("keeps zero-participation sessions empty without assigning ratings", () => {
  const emptyData = { ...data, canManage: false, results: [], details: [], awards: [] };
  const ratings = renderToStaticMarkup(<SessionPerformance data={emptyData} />);
  const nominations = renderToStaticMarkup(<SessionNominations data={emptyData} />);
  expect(ratings).toContain("No player performance is available");
  expect(nominations).toContain("No nominations yet.");
});
