import { describe, expect, it } from "vitest";
import { availableCreditCents, totalPlayerCreditRemainingCents } from "../financial";

describe("total player credit remaining", () => {
  it("sums positive balances without subtracting players who owe", () => {
    expect(totalPlayerCreditRemainingCents([
      { payments: ["25.00"] },
      { payments: ["40.00"] },
      { payments: ["15.00"], charges: ["30.00"] }
    ])).toBe(6500);
  });

  it("includes zero balances, inactive-player activity, and payment without attendance", () => {
    const zeroBalance = availableCreditCents({ payments: ["24.00"], charges: ["24.00"] });
    const inactivePlayerCredit = availableCreditCents({ payments: ["36.00"], charges: ["12.00"] });
    const paidWithoutAttendance = availableCreditCents({ payments: ["48.00"] });
    expect(zeroBalance).toBe(0);
    expect(inactivePlayerCredit).toBe(2400);
    expect(paidWithoutAttendance).toBe(4800);
  });

  it("applies refunds, transfers, and signed manual adjustments", () => {
    expect(availableCreditCents({
      payments: ["100.00"],
      charges: ["20.00"],
      adjustments: [
        { type: "refund_paid", amount: "15.00" },
        { type: "credit_added", amount: "10.00" },
        { type: "credit_transferred_in", amount: "5.00" },
        { type: "credit_transferred_out", amount: "8.00" },
        { type: "manual_adjustment", amount: "-2.00" }
      ]
    })).toBe(7000);
  });

  it("preserves cent accuracy across seasons and counts each supplied record once", () => {
    expect(availableCreditCents({
      payments: ["10.10", "20.20"],
      charges: ["5.05"],
      adjustments: [{ type: "credit_added", amount: "0.01" }]
    })).toBe(2526);
  });
});

