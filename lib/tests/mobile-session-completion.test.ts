import { expect, it } from "vitest";
import { canCompleteSession, type Workspace } from "../../packages/contracts/src";

const manager: Workspace = { organizationId: "org", organizationName: "OU", programId: "program", programName: "Soccer", activityType: "soccer", role: "manager", playerId: null, currency: "CAD", modules: {} };
it("shows completion only for a manager's scheduled session", () => {
  expect(canCompleteSession(manager, "scheduled")).toBe(true);
  for (const status of ["completed", "cancelled", ""]) expect(canCompleteSession(manager, status)).toBe(false);
  expect(canCompleteSession(null, "scheduled")).toBe(false);
  for (const role of ["captain", "member"] as const) expect(canCompleteSession({ ...manager, role }, "scheduled")).toBe(false);
});
it("requires both activity and attendance modules", () => {
  for (const module of ["activities", "attendance"]) expect(canCompleteSession({ ...manager, modules: { [module]: false } }, "scheduled")).toBe(false);
});
