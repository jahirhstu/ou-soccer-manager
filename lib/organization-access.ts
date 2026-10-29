import type { createSupabaseServerClient } from "./supabase/server";

type ServerSupabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export async function hasOrganizationAdminAuthority(
  supabase: ServerSupabase,
  organizationId: string | null | undefined
) {
  if (!organizationId) return false;
  const { data, error } = await supabase.rpc("organization_role", { p_organization_id: organizationId });
  return !error && data === "admin";
}

export async function requireOrganizationAdminAuthority(
  supabase: ServerSupabase,
  organizationId: string | null | undefined
) {
  if (!(await hasOrganizationAdminAuthority(supabase, organizationId))) {
    throw new Error("Organization owner or administrator access is required.");
  }
}
