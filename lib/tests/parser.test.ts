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

  it("uses the current year when a month/day date has no year", async () => {
    const parser = new RuleBasedWhatsAppParser();
    const result = await parser.parse(`
      Game May 27
      Naveed - Sent
      Score 8-6
    `);

    expect(result.session?.date).toBe(`${new Date().getFullYear()}-05-27`);
  });

  it("defaults missing payment method to e-transfer", async () => {
    const parser = new RuleBasedWhatsAppParser();
    const result = await parser.parse(`
      Game May 27
      Rafi paid 12
    `);

    expect(result.payments[0].paymentMethod).toBe("e-transfer");
  });

  it("does not treat a general drop-in amount as each sent player's explicit payment", async () => {
    const parser = new RuleBasedWhatsAppParser();
    const result = await parser.parse(`
      Date: Wednesday, May 20th
      12$ for drop ins
      1. Imon (Sent)
      2. Zayan (Sent)
    `);

    expect(result.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ playerName: "Imon", amount: undefined, sessionsCovered: 1, amountSource: "inferred_session_price" }),
        expect.objectContaining({ playerName: "Zayan", amount: undefined, sessionsCovered: 1, amountSource: "inferred_session_price" })
      ])
    );
  });

  it("marks an amount beside a player as a player-line payment", async () => {
    const parser = new RuleBasedWhatsAppParser();
    const result = await parser.parse(`
      Game May 27
      Jahir - Payment $30
      Mim - $70 paid
    `);

    expect(result.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ playerName: "Jahir", amount: 30, amountSource: "player_line" }),
        expect.objectContaining({ playerName: "Mim", amount: 70, amountSource: "player_line" })
      ])
    );
  });

  it("keeps parenthesized status out of numbered roster player names", async () => {
    const parser = new RuleBasedWhatsAppParser();
    const result = await parser.parse(`
      Date: Wednesday, May 20th
      25. Morshed (Replaced) (Sent)
    `);

    expect(result.players).toEqual([expect.objectContaining({ name: "Morshed" })]);
    expect(result.payments).toEqual([
      expect.objectContaining({ playerName: "Morshed", amountSource: "inferred_session_price" })
    ]);
  });

  it("pairs a replaced player with the previous dropped roster player", async () => {
    const parser = new RuleBasedWhatsAppParser();
    const result = await parser.parse(`
      Date: Wednesday, May 20th
      8. Mim (Dropped) (Balance will remain)
      25. Morshed (Replaced) (Sent)
    `);

    expect(result.attendance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ playerName: "Mim", status: "dropped" }),
        expect.objectContaining({ playerName: "Morshed", status: "replacement" })
      ])
    );
    expect(result.dropouts).toEqual([
      expect.objectContaining({ originalPlayerName: "Mim", replacementPlayerName: "Morshed" })
    ]);
  });

  it("pairs replacement-of roster rows with dropped players", async () => {
    const parser = new RuleBasedWhatsAppParser();
    const result = await parser.parse(`
      Date: Wednesday, June 03rd
      9. Ayaan Shahreir - Dropped
      16. Sazzad - Dropped
      25. Habib - Replacement of Ayaan Shahreir
      26. Mim - Replacement of Sazzad
    `);

    expect(result.attendance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ playerName: "Ayaan Shahreir", status: "dropped" }),
        expect.objectContaining({ playerName: "Sazzad", status: "dropped" }),
        expect.objectContaining({ playerName: "Habib", status: "replacement" }),
        expect.objectContaining({ playerName: "Mim", status: "replacement" })
      ])
    );
    expect(result.dropouts).toEqual([
      expect.objectContaining({ originalPlayerName: "Ayaan Shahreir", replacementPlayerName: "Habib" }),
      expect.objectContaining({ originalPlayerName: "Sazzad", replacementPlayerName: "Mim" })
    ]);
  });

  it("keeps dropped attendance authoritative over earlier confirmed text", async () => {
    const parser = new RuleBasedWhatsAppParser();
    const result = await parser.parse(`
      Date: Wednesday, June 03rd
      Ayaan Shahreir confirmed
      9. Ayaan Shahreir - Dropped
      25. Habib - Replacement of Ayaan Shahreir
    `);

    expect(result.attendance.filter((row) => row.playerName === "Ayaan Shahreir")).toEqual([
      expect.objectContaining({ status: "dropped" })
    ]);
    expect(result.attendance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ playerName: "Habib", status: "replacement" })
      ])
    );
  });

  it("extracts mini-game match scores", async () => {
    const parser = new RuleBasedWhatsAppParser();
    const result = await parser.parse(`
      Date: May 27
      Game 1: Matha Gorom 2 - 1 Thanda Matha
      Game 2:
      Thanda Matha 1 - 0 Agun
    `);

    expect(result.matches).toEqual([
      expect.objectContaining({ matchNumber: 1, teamAName: "Matha Gorom", teamAScore: 2, teamBScore: 1, teamBName: "Thanda Matha" }),
      expect.objectContaining({ matchNumber: 2, teamAName: "Thanda Matha", teamAScore: 1, teamBScore: 0, teamBName: "Agun" })
    ]);
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
