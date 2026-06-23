const reservedSegments = new Set([
  "_next",
  "api",
  "attendance",
  "dashboard",
  "expenses",
  "favicon.ico",
  "import-whatsapp",
  "invite",
  "join",
  "leagues",
  "login",
  "payments",
  "platform",
  "performance",
  "players",
  "programs",
  "public",
  "reports",
  "select-context",
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

export function getProgramSlugFromPathname(pathname: string) {
  const [, secondSegment] = pathname.split("/").filter(Boolean);
  return normalizePathSegment(secondSegment);
}

export function stripTenantFromPathname(pathname: string) {
  const slug = getTenantSlugFromPathname(pathname);
  if (!slug) return pathname;
  const programSlug = getProgramSlugFromPathname(pathname);
  const prefixLength = programSlug ? slug.length + programSlug.length + 2 : slug.length + 1;
  const withoutSlug = pathname.slice(prefixLength);
  return withoutSlug || "/";
}

export function tenantPath(pathname: string, tenantSlug?: string | null, programSlug?: string | null) {
  const slug = normalizeTenantSlug(tenantSlug);
  if (!slug || !pathname.startsWith("/")) return pathname;
  if (getTenantSlugFromPathname(pathname)) return pathname;
  const program = normalizePathSegment(programSlug);
  return program ? `/${slug}/${program}${pathname}` : `/${slug}${pathname}`;
}

export function getActiveProgramSlugForTenant(
  tenantSlug: string | null | undefined,
  cookieTenantSlug: string | null | undefined,
  cookieProgramSlug: string | null | undefined
) {
  const tenant = normalizeTenantSlug(tenantSlug);
  const cookieTenant = normalizeTenantSlug(cookieTenantSlug);
  if (!tenant || tenant !== cookieTenant) return "";
  return normalizePathSegment(cookieProgramSlug);
}

function normalizePathSegment(value: string | null | undefined) {
  const slug = normalizeTenantSlug(value);
  if (!slug || reservedSegments.has(slug)) return "";
  return slug;
}
