import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { balancedDraftRounds } from "../../packages/contracts/src/draft-order";
import { currentDraftCategory, normalizeDraftCategoryOverrides, profileDraftCategory } from "../team-builder-draft";
import type { TeamBuilderData } from "../../components/TeamBuilder";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/actions/team-builder", () => ({
  autosaveSessionTeamBuilderDraft: vi.fn(),
  saveSessionTeamBuilder: vi.fn()
}));
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: vi.fn() }));

import { TeamBuilder } from "../../components/TeamBuilder";

const guidedData: TeamBuilderData = {
  session: { id: "session", name: "Sunday", status: "scheduled" },
  settings: { playersPerTeam: 7 },
  players: [
    { id: "keeper", name: "Keeper Captain", status: "confirmed", preferredPosition: "goalkeeper" },
    { id: "defender", name: "Defender", status: "confirmed", preferredPosition: "defender" },
    { id: "midfielder", name: "Midfielder Captain", status: "confirmed", preferredPosition: "midfielder" },
    { id: "no-position", name: "Unassigned Player", status: "confirmed" }
  ],
  teams: [],
  draft: {
    teams: [
      { key: "team-a", name: "Team A", captainPlayerId: "keeper", playerIds: ["keeper", "defender"] },
      { key: "team-b", name: "Team B", captainPlayerId: "midfielder", playerIds: ["midfielder"] }
    ],
    playersPerTeam: 7,
    draftMode: "guided",
    pickCursor: 1,
    tossOrderKeys: ["team-a", "team-b"],
    draftPositionCategories: { defender: "forward" }
  }
};

describe("guided team draft categories", () => {
  it("uses profile positions by default, supports unassigned players, and restores the profile category", () => {
    const players = [
      { id: "one", preferredPosition: " Defender " },
      { id: "two", preferredPosition: null }
    ];
    expect(profileDraftCategory(players[0].preferredPosition)).toBe("defender");
    expect(profileDraftCategory(players[1].preferredPosition)).toBe("unassigned");
    const overrides = normalizeDraftCategoryOverrides({
      one: "goalkeeper",
      two: "forward",
      unknown: "defender",
      invalid: "striker"
    }, players);
    expect(overrides).toEqual({ one: "goalkeeper", two: "forward" });
    expect(currentDraftCategory(players[0], overrides)).toBe("goalkeeper");
    expect(normalizeDraftCategoryOverrides({ one: "defender" }, players)).toEqual({});
  });

  it("renders guided position groups and counts captains in team composition", () => {
    const html = renderToStaticMarkup(<TeamBuilder canEdit data={guidedData} sessionId="session" />);
    expect(html).toContain("Guided");
    expect(html).toContain(">Lottery</button>");
    expect(html).toContain(">Balanced</button>");
    expect(html).toContain(">Guided</button>");
    expect(html).toContain("Goalkeeper draft pool");
    expect(html).toContain("Defender draft pool");
    expect(html).toContain("Midfielder draft pool");
    expect(html).toContain("Forward draft pool");
    expect(html).toContain("Unassigned draft pool");
    expect(html).toContain("grid grid-cols-5 gap-1 sm:gap-2");
    expect(html).toContain("Team position composition");
    expect(html).toContain("Zero counts show position gaps");
    expect(html).toContain("Midfielder Captain picks now");
    expect(html).toContain('aria-label="Defender draft category"');
    expect(html).toContain('aria-label="Reset Defender draft category"');
    expect(html).toContain("GK");
    expect(html).toContain("DEF");
    expect(html).toContain("MID");
    expect(html).toContain("FWD");
    expect(html).toContain('aria-label="Team A position counts"');
    expect(html).toContain('aria-label="Team B position counts"');
    expect(html).toContain('aria-label="Open actions for Unassigned Player"');
    expect(html).not.toContain("overflow-x-auto");
    const unassignedPool = html.match(/aria-label="Unassigned draft pool"([\s\S]*?)<\/section>/)?.[1] ?? "";
    expect(unassignedPool).not.toContain("A-");
    expect(unassignedPool).not.toContain("D-");
    expect(unassignedPool).not.toContain("G-");
    expect(unassignedPool).not.toContain('aria-label="Unassigned Player draft category"');
  });

  it("preserves the existing balanced captain order for two- and three-team drafts", () => {
    const teams = ["a", "b", "c"].map((key) => ({ key }));
    expect(balancedDraftRounds(teams.slice(0, 2), 4).map((round) => round.map((team) => team.key).join("")))
      .toEqual(["ab", "ba", "ab", "ba"]);
    expect(balancedDraftRounds(teams, 4).map((round) => round.map((team) => team.key).join("")))
      .toEqual(["abc", "cba", "bac", "abc"]);
    for (const teamCount of [2, 3]) {
      const rounds = balancedDraftRounds(teams.slice(0, teamCount), 7);
      expect(rounds.flat()).toHaveLength(teamCount === 2 ? 14 : 21);
      for (const team of teams.slice(0, teamCount)) {
        expect(rounds.flat().filter((pick) => pick.key === team.key)).toHaveLength(7);
      }
    }
  });
});
