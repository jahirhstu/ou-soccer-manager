import { describe, expect, it } from "vitest";
import { RuleBasedWhatsAppParser } from "../parsers/rule-based";

describe("RuleBasedWhatsAppParser", () => {
  it("extracts payments, dropouts, scores, goals, and assists", async () => {
    const parser = new RuleBasedWhatsAppParser();
    const result = await parser.parse(`
      Game 2026-05-21
      Ahmed paid $45 for 3 sessions e-transfer
      Omar out, Leo takes spot
      Score 8-6
      Ahmed 2 goals
      Goal: Marco assist John
    `);
    expect(result.importType).toBe("session_update");
    expect(result.session?.date).toBe("2026-05-21");
    expect(result.payments[0].amount).toBe(45);
    expect(result.dropouts.length).toBeGreaterThan(0);
    expect(result.score?.teamAScore).toBe(8);
    expect(result.goals).toHaveLength(2);
  });

  it("extracts numbered season signup rows with inline payments", async () => {
    const parser = new RuleBasedWhatsAppParser();
    const result = await parser.parse(`
      OU Ottawa Soccer Player Signup – Summer Season
      Season Dates: May 20 to September 9
      Time: 9:00 PM – 11:00PM
      Location: Ottawa Megadome, 5315 Abbott St, Stittsville, ON K2S 0X3
      Total Sessions: 16
      Cost per Session: $12 CAD
      Full Season Cost: $192 CAD
      For players who already paid $70 CAD:
      Remaining balance = $122 CAD

       1. Wali - 192 CAD paid
       2. Rocky bhai - 192 CAD paid
       3. Naveed
       4. Mim - 70 paid, 122 left
       5. Habib [Available after june 5th]
    `);

    expect(result.importType).toBe("season_signup");
    expect(result.session?.location).toContain("Ottawa Megadome");
    expect(result.session?.totalSessions).toBe(16);
    expect(result.session?.pricePerSession).toBe(12);
    expect(result.players.map((player) => player.name)).toEqual(["Wali", "Rocky Bhai", "Naveed", "Mim", "Habib"]);
    expect(result.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ playerName: "Wali", amount: 192, sessionsCovered: 16 }),
        expect.objectContaining({ playerName: "Mim", amount: 70 })
      ])
    );
    expect(result.warnings.some((warning) => warning.includes("Mim has 122 CAD"))).toBe(true);
  });
});
