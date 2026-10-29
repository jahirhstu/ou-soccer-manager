import { expect, it } from "vitest";
import { balanceDescription, filterRecordPage, recordStatus, resourceModule, type ListRow } from "../../packages/contracts/src";

it("keeps credit and debt labels distinct without floating-point conversions", () => {
  expect(balanceDescription("CAD 120.01")).toBe("Available credit");
  expect(balanceDescription("CAD -12.00")).toBe("Amount owed");
  expect(balanceDescription("CAD 0.00")).toBe("Settled");
  expect(balanceDescription("CAD -0.00")).toBe("Settled");
  expect(balanceDescription("CAD 999999999999.99")).toBe("Available credit");
  expect(balanceDescription("Unknown")).toBe("Balance");
});

const members: ListRow[] = [
  { id: "1", title: "Alex", subtitle: "captain / active", detail: "alex@example.test" },
  { id: "2", title: "Sam", subtitle: "member / pending", detail: "sam@example.test" },
];
it("filters a loaded page by text and status without confusing role with membership status", () => {
  expect(recordStatus("members", members[0])).toBe("active");
  expect(filterRecordPage(members, "members", " ALEX ", "active")).toEqual([members[0]]);
  expect(filterRecordPage(members, "members", "alex", "pending")).toEqual([]);
  expect(filterRecordPage(members, "members", "example.test", "")).toEqual(members);
  expect(filterRecordPage([], "members", "", "")).toEqual([]);
});
it("reads statuses only for resources with a status contract", () => {
  expect(recordStatus("sessions", { ...members[0], subtitle: "2026-10-04 / completed" })).toBe("completed");
  expect(recordStatus("players", { ...members[0], subtitle: "inactive" })).toBe("inactive");
  expect(recordStatus("myBalances", { ...members[0], subtitle: "Summer / Fall" })).toBe("");
});
it("maps native navigation to the existing module permissions", () => {
  expect(resourceModule("myBalances")).toBe("payments");
  expect(resourceModule("expenses")).toBe("expenses");
  expect(resourceModule("members")).toBe("members");
  expect(resourceModule("players")).toBe("members");
  expect(resourceModule("myStatistics")).toBe("scores");
  expect(resourceModule("upcomingSessions")).toBe("activities");
});
