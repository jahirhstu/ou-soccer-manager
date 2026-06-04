import { describe, expect, it } from "vitest";
import { canManageFinance, hasPermission, isSessionScoreReadOnly } from "../permissions";

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

  it("allows only admins to edit past-date session scores", () => {
    const pastSession = { session_date: "2026-06-03", status: "scheduled" };

    expect(isSessionScoreReadOnly("admin", pastSession, "2026-06-04")).toBe(false);
    expect(isSessionScoreReadOnly("captain", pastSession, "2026-06-04")).toBe(true);
    expect(isSessionScoreReadOnly("player", pastSession, "2026-06-04")).toBe(true);
    expect(isSessionScoreReadOnly(undefined, pastSession, "2026-06-04")).toBe(true);
  });

  it("keeps completed session scores read-only for every role", () => {
    const completedSession = { session_date: "2026-06-04", status: "completed" };

    expect(isSessionScoreReadOnly("admin", completedSession, "2026-06-04")).toBe(true);
    expect(isSessionScoreReadOnly("captain", completedSession, "2026-06-04")).toBe(true);
    expect(isSessionScoreReadOnly("player", completedSession, "2026-06-04")).toBe(true);
    expect(isSessionScoreReadOnly(undefined, completedSession, "2026-06-04")).toBe(true);
  });
});
