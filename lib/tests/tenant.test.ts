import { describe, expect, it } from "vitest";
import { getActiveProgramSlugForTenant, getProgramSlugFromPathname, getTenantSlugFromPathname, stripTenantFromPathname, tenantPath } from "../tenant";

describe("tenant and program routing", () => {
  it("resolves organization signup without treating signup as a program", () => {
    expect(getTenantSlugFromPathname("/north-club/signup")).toBe("north-club");
    expect(getProgramSlugFromPathname("/north-club/signup")).toBe("");
    expect(stripTenantFromPathname("/north-club/signup")).toBe("/signup");
  });

  it("resolves program-scoped routes", () => {
    expect(getProgramSlugFromPathname("/north-club/soccer/sessions")).toBe("soccer");
    expect(stripTenantFromPathname("/north-club/soccer/sessions")).toBe("/sessions");
  });

  it("keeps global platform and invitation routes unscoped", () => {
    expect(getTenantSlugFromPathname("/platform/organizations")).toBe("");
    expect(getTenantSlugFromPathname("/invite/token")).toBe("");
  });

  it("builds organization and program paths explicitly", () => {
    expect(tenantPath("/settings", "north-club")).toBe("/north-club/settings");
    expect(tenantPath("/sessions", "north-club", "soccer")).toBe("/north-club/soccer/sessions");
  });

  it("restores an active program only for the organization that selected it", () => {
    expect(getActiveProgramSlugForTenant("north-club", "north-club", "soccer")).toBe("soccer");
    expect(getActiveProgramSlugForTenant("south-club", "north-club", "soccer")).toBe("");
  });
});
