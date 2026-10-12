import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), profile: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc }), getCurrentProfile: mocks.profile }));
vi.mock("@/components/PublicShell", () => ({ PublicShell: ({ children }: any) => <main>{children}</main> }));
vi.mock("@/components/TeamBuilder", () => ({ TeamBuilder: () => <div>Team builder</div> }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("Not found"); } }));

import SummaryPage from "../../app/public/sessions/[id]/summary/page";
import TeamsPage from "../../app/public/sessions/[id]/teams/page";

const session = { id: "session", name: "Sunday", sessionDate: "2026-10-04", playgroundName: "Field 2", location: "Bell Senseplex", seasonName: "Fall", status: "completed", pricePerSession: 13 };
const detail = { session, matches: [{ matchNumber: 1, teamAId: "a", teamBId: "b", teamAName: "Team A", teamBName: "Team B", teamAScore: 1, teamBScore: 0, awayTeamId: "b", resultStatus: "played" }], goals: [{ matchNumber: 1, goalType: "goal", scorerName: "Scorer", assistName: "Assistant", teamName: "Team A", goalCount: 1 }] };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.profile.mockResolvedValue({ role: "admin" });
  mocks.rpc.mockResolvedValue({ data: detail, error: null });
});

describe("summary share controls", () => {
  it("shows three separate actions with the renamed cards and field context", async () => {
    const html = renderToStaticMarkup(await SummaryPage({ params: Promise.resolve({ id: "session" }) }));
    for (const label of ["Share podium &amp; standings", "Share scorers &amp; assists", "Share match results", ">Scorers</h2>", ">Assists</h2>", "Field 2"]) expect(html).toContain(label);
    expect(html.match(/aria-busy="false"/g)).toHaveLength(3);
    expect(html).not.toContain("Top scorers");
    expect(html).not.toContain("Top assists");
  });

  it("preserves captain access and hides sharing for anonymous visitors", async () => {
    mocks.profile.mockResolvedValue({ role: "captain" });
    expect(renderToStaticMarkup(await SummaryPage({ params: Promise.resolve({ id: "session" }) }))).toContain("Share match results");
    mocks.profile.mockResolvedValue(null);
    const html = renderToStaticMarkup(await SummaryPage({ params: Promise.resolve({ id: "session" }) }));
    expect(html).not.toContain("Share match results");
    expect(html).not.toContain("Share podium");
    expect(html).toContain("Scorer");
  });

  it("does not offer empty reports for sharing", async () => {
    mocks.rpc.mockResolvedValue({ data: { session, matches: [], goals: [] }, error: null });
    const html = renderToStaticMarkup(await SummaryPage({ params: Promise.resolve({ id: "session" }) }));
    expect(html).not.toContain("aria-busy");
  });
});

describe("saved teams sharing", () => {
  it("exports only saved rosters, not draft picks or player skill data", async () => {
    mocks.rpc.mockResolvedValue({ data: { session, players: [], teams: [{ id: "a", name: "Saved Team", captainPlayerId: "player", players: [{ id: "player", name: "Saved Player", attackingSkillPercent: 90 }] }], draft: { teams: [{ name: "Draft Team", playerIds: ["draft-player"] }] } }, error: null });
    const html = renderToStaticMarkup(await TeamsPage({ params: Promise.resolve({ id: "session" }) }));
    expect(html).toContain("Share teams");
    expect(html).toContain("Saved Player");
    expect(html).not.toContain("Draft Team");
    expect(html).not.toContain("attackingSkillPercent");
  });

  it("does not offer sharing before teams have been saved", async () => {
    mocks.rpc.mockResolvedValue({ data: { session, players: [], teams: [], draft: { teams: [{ name: "Draft" }] } }, error: null });
    expect(renderToStaticMarkup(await TeamsPage({ params: Promise.resolve({ id: "session" }) }))).not.toContain("Share teams");
  });
});
