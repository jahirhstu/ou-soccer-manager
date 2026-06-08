"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../supabase/server";
import { normalizeTenantSlug, tenantPath } from "../tenant";
import { getRequestTenantSlug } from "../tenant-server";

export async function loginAction(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const tenantSlug = normalizeTenantSlug(String(formData.get("tenant_slug") ?? ""));
  const programSlug = normalizeTenantSlug(String(formData.get("program_slug") ?? ""));
  const email = buildOuSoccerEmail(formData);
  if (!email) redirect(`${tenantPath("/login", tenantSlug, programSlug)}?error=Enter%20a%20valid%20name.`);
  const password = String(formData.get("password"));
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect(`${tenantPath("/login", tenantSlug, programSlug)}?error=${encodeURIComponent(error.message)}`);
  const { data: auth } = await supabase.auth.getUser();
  if (auth.user) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
    if (profile?.role === "captain") redirect(tenantPath("/sessions", tenantSlug, programSlug));
  }
  redirect(tenantPath("/dashboard", tenantSlug, programSlug));
}

export async function signupAction(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const tenantSlug = normalizeTenantSlug(String(formData.get("tenant_slug") ?? ""));
  const programSlug = normalizeTenantSlug(String(formData.get("program_slug") ?? ""));
  const email = buildOuSoccerEmail(formData);
  if (!email) redirect(`${tenantPath("/signup", tenantSlug, programSlug)}?error=Enter%20a%20valid%20email%20name.`);
  const password = String(formData.get("password"));
  const displayName = String(formData.get("displayName"));
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName, organization_slug: tenantSlug || undefined, program_slug: programSlug || undefined } }
  });
  if (error) redirect(`${tenantPath("/signup", tenantSlug, programSlug)}?error=${encodeURIComponent(error.message)}`);
  if (tenantSlug) {
    const { error: membershipError } = await supabase.rpc("ensure_membership_for_slug", {
      p_role: "player",
      p_slug: tenantSlug
    });
    if (membershipError) redirect(`${tenantPath("/signup", tenantSlug, programSlug)}?error=${encodeURIComponent(membershipError.message)}`);
    if (programSlug) {
      const { error: programMembershipError } = await supabase.rpc("ensure_program_membership_for_slug", {
        p_organization_slug: tenantSlug,
        p_program_slug: programSlug
      });
      if (programMembershipError) redirect(`${tenantPath("/signup", tenantSlug, programSlug)}?error=${encodeURIComponent(programMembershipError.message)}`);
    }
  }
  redirect(tenantPath("/dashboard", tenantSlug, programSlug));
}

export async function logoutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const tenantSlug = await getRequestTenantSlug();
  await supabase.auth.signOut();
  redirect(tenantPath("/login", tenantSlug));
}

function buildOuSoccerEmail(formData: FormData) {
  const name = String(formData.get("emailName") ?? "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(name)) return "";
  return `${name}@ou.soccer`;
}
