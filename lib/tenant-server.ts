import { cookies, headers } from "next/headers";
import { normalizeTenantSlug } from "./tenant";

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
