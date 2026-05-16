import { describe, expect, it } from "vitest";
import { canManageFinance, hasPermission } from "../permissions";

describe("role permissions", () => {
  it("allows admin to manage finance", () => {
    expect(canManageFinance("admin")).toBe(true);
  });

  it("prevents captain and player from managing finance", () => {
    expect(canManageFinance("captain")).toBe(false);
    expect(canManageFinance("player")).toBe(false);
  });

  it("allows captain to manage attendance", () => {
    expect(hasPermission("captain", "manage_attendance")).toBe(true);
  });
});
