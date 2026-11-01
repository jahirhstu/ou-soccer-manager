const captainAllowedPaths = ["/sessions", "/performance", "/leagues", "/attendance", "/reports/leaderboards", "/reports/playground-stats"];

export function isCaptainAllowedRoute(pathname: string) {
  if (pathname === "/sessions") return true;
  if (captainAllowedPaths.some((path) => path !== "/sessions" && (pathname === path || pathname.startsWith(`${path}/`)))) {
    return true;
  }
  if (/^\/sessions\/[^/]+$/.test(pathname)) return true;
  return /^\/sessions\/[^/]+\/(?:fixture|lineups|scores|performance|nomination)(?:\/.*)?$/.test(pathname);
}
