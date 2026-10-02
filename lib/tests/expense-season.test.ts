import { describe, expect, it } from "vitest";
import { expenseSchema } from "../schemas";

const expense = {
  expense_date: "2026-10-02",
  category: "dome_rent",
  amount: "25.00",
  season_id: "11111111-1111-4111-8111-111111111111"
};

describe("expense season requirement", () => {
  it("accepts a season-assigned expense", () => {
    expect(expenseSchema.safeParse(expense).success).toBe(true);
  });

  it("rejects a new expense without a season", () => {
    expect(expenseSchema.safeParse({ ...expense, season_id: null }).success).toBe(false);
  });
});
