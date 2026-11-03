export function isPlayerAllowedRoute(pathname: string) {
  return /^\/sessions\/[^/]+\/(?:lineups|nomination)(?:\/.*)?$/.test(pathname);
}
