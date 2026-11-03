import { describe, expect, it } from "vitest";
import { isPlayerAllowedRoute } from "../player-routes";

describe("player session route access", () => {
  it.each([
    "/sessions/session-1/lineups",
    "/sessions/session-1/nomination"
  ])("allows %s", (pathname) => {
    expect(isPlayerAllowedRoute(pathname)).toBe(true);
  });

  it.each([
    "/sessions",
    "/sessions/session-1",
    "/sessions/session-1/performance",
    "/sessions/session-1/nomination-admin",
    "/sessions/session-1/scores"
  ])("does not grant player access to %s", (pathname) => {
    expect(isPlayerAllowedRoute(pathname)).toBe(false);
  });
});
