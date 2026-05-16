import { describe, expect, it } from "vitest";
import { calculatePlayerBalance, calculateRemainingSessions, ledgerEntriesForDropoutTransfer } from "../balance";

describe("balance helpers", () => {
  it("calculates remaining sessions", () => {
    expect(calculateRemainingSessions(5, 3)).toBe(2);
    expect(calculateRemainingSessions(2, 4)).toBe(0);
  });

  it("calculates player balance", () => {
    const balance = calculatePlayerBalance({
      payments: [{ amount: 75, sessions_covered: 5 }],
      attendance: [{ status: "played" }, { status: "replacement" }],
      ledgerEntries: [],
      pricePerSession: 15
    });
    expect(balance.remainingPaidSessions).toBe(3);
    expect(balance.creditBalance).toBe(45);
    expect(balance.owesAmount).toBe(0);
  });

  it("creates dropout transfer ledger entries", () => {
    const entries = ledgerEntriesForDropoutTransfer({
      transferType: "replacement_owes_original_player",
      originalPlayerId: "original",
      replacementPlayerId: "replacement",
      pricePerSession: 15
    });
    expect(entries).toHaveLength(2);
    expect(entries[0].type).toBe("credit_transferred_out");
    expect(entries[1].type).toBe("credit_transferred_in");
  });
});
