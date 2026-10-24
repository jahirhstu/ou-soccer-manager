import { describe, expect, it } from "vitest";
import { resolveDashboardSeason } from "../dashboard-seasons";

const seasons = [{ id: "latest", status: "archived" }, { id: "active", status: "active" }, { id: "older", status: "archived" }];

describe("dashboard season selection", () => {
  it("defaults to the configured active season", () => expect(resolveDashboardSeason(seasons)?.id).toBe("active"));
  it("allows an accessible historical season", () => expect(resolveDashboardSeason(seasons, "older")?.id).toBe("older"));
  it("falls back for inaccessible or invalid IDs", () => expect(resolveDashboardSeason(seasons, "other-organization")?.id).toBe("active"));
  it("uses the most recent season if none is active", () => expect(resolveDashboardSeason(seasons.filter((s) => s.status !== "active"))?.id).toBe("latest"));
  it("handles an organization without seasons", () => expect(resolveDashboardSeason([])).toBeUndefined());
});
