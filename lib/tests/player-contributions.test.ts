import { describe, expect, it } from "vitest";
import { mergePlayerContributions } from "@/lib/player-contributions";

describe("combined player contributions", () => {
  it("merges overlapping contributors, fills zeros, excludes noncontributors and sorts", () => {
    const rows = mergePlayerContributions([
      { playerName: "Goals only", teamNames: "Team A", total: 2 },
      { playerName: "Both", teamNames: "Team A", total: 2 },
      { playerName: "Neither", teamNames: "Team A", total: 0 }
    ], [
      { playerName: "Assists only", teamNames: "Team B", total: 3 },
      { playerName: "Both", teamNames: "Team B", total: 1 }
    ]);
    expect(rows).toEqual([
      { playerName: "Both", teamNames: "Team A, Team B", goals: 2, assists: 1 },
      { playerName: "Goals only", teamNames: "Team A", goals: 2, assists: 0 },
      { playerName: "Assists only", teamNames: "Team B", goals: 0, assists: 3 }
    ]);
  });
  it("handles empty lists and deterministic alphabetical ties", () => {
    expect(mergePlayerContributions([], [])).toEqual([]);
    expect(mergePlayerContributions([], ["Z", "A"].map(playerName => ({ playerName, teamNames: "-", total: 1 })))).toEqual([
      { playerName: "A", teamNames: "-", goals: 0, assists: 1 },
      { playerName: "Z", teamNames: "-", goals: 0, assists: 1 }
    ]);
  });
});
