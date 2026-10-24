import { cookies, headers } from "next/headers";
import { normalizeTenantSlug, tenantPath } from "./tenant";

export async function getScopedPath(path: string) {
  return tenantPath(path, await getRequestTenantSlug(), await getRequestProgramSlug());
}

export async function getRequestTenantSlug() {
  const requestHeaders = await headers();
  const headerSlug = normalizeTenantSlug(requestHeaders.get("x-tenant-slug"));
  if (headerSlug) return headerSlug;

  const cookieStore = await cookies();
  return normalizeTenantSlug(cookieStore.get("active_organization_slug")?.value);
}

export async function getRequestProgramSlug() {
  const requestHeaders = await headers();
  return normalizeTenantSlug(requestHeaders.get("x-program-slug"));
}

export async function getActiveProgramSlug() {
  const requestHeaders = await headers();
  const routeProgramSlug = normalizeTenantSlug(requestHeaders.get("x-program-slug"));
  if (routeProgramSlug) return routeProgramSlug;
  return normalizeTenantSlug(requestHeaders.get("x-active-program-slug"));
}
