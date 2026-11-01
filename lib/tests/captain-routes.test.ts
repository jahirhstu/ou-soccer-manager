import { describe, expect, it } from "vitest";
import { isCaptainAllowedRoute } from "../captain-routes";

describe("captain session route access", () => {
  it.each([
    "/sessions",
    "/sessions/session-1",
    "/sessions/session-1/performance",
    "/sessions/session-1/nomination",
    "/sessions/session-1/fixture",
    "/sessions/session-1/lineups",
    "/sessions/session-1/scores"
  ])("allows %s", (pathname) => {
    expect(isCaptainAllowedRoute(pathname)).toBe(true);
  });

  it.each([
    "/dashboard",
    "/players",
    "/sessions/session-1/payments",
    "/sessions/session-1/nomination-admin"
  ])("does not grant captain access to %s", (pathname) => {
    expect(isCaptainAllowedRoute(pathname)).toBe(false);
  });
});
