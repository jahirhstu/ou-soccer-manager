const reservedSegments = new Set([
  "_next",
  "api",
  "attendance",
  "dashboard",
  "expenses",
  "favicon.ico",
  "import-whatsapp",
  "leagues",
  "login",
  "payments",
  "players",
  "public",
  "reports",
  "seasons",
  "sessions",
  "settings",
  "setup",
  "signup",
  "users"
]);

export function normalizeTenantSlug(value: string | null | undefined) {
  const slug = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return "";
  if (reservedSegments.has(slug)) return "";
  return slug;
}

export function getTenantSlugFromPathname(pathname: string) {
  const [firstSegment] = pathname.split("/").filter(Boolean);
  return normalizeTenantSlug(firstSegment);
}

export function stripTenantFromPathname(pathname: string) {
  const slug = getTenantSlugFromPathname(pathname);
  if (!slug) return pathname;
  const withoutSlug = pathname.slice(slug.length + 1);
  return withoutSlug || "/";
}

export function tenantPath(pathname: string, tenantSlug?: string | null) {
  const slug = normalizeTenantSlug(tenantSlug);
  if (!slug || !pathname.startsWith("/")) return pathname;
  if (getTenantSlugFromPathname(pathname)) return pathname;
  return `/${slug}${pathname}`;
}
