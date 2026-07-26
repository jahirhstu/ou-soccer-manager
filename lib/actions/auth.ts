"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "../supabase/server";
import { normalizeTenantSlug, tenantPath } from "../tenant";

export async function loginAction(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const tenantSlug = normalizeTenantSlug(String(formData.get("tenant_slug") ?? ""));
  const programSlug = normalizeTenantSlug(String(formData.get("program_slug") ?? ""));
  const email = buildEmail(formData);
  if (!email) redirect(`${tenantPath("/login", tenantSlug, programSlug)}?error=Enter%20a%20valid%20email.`);
  const password = String(formData.get("password"));
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect(`${tenantPath("/login", tenantSlug, programSlug)}?error=${encodeURIComponent(error.message)}`);
  const nextPath = safeNextPath(String(formData.get("next") ?? ""));
  if (nextPath) redirect(nextPath);
  if (tenantSlug) redirect(tenantPath("/dashboard", tenantSlug, programSlug));
  await redirectForMemberships(supabase);
}

export async function signupAction(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const tenantSlug = normalizeTenantSlug(String(formData.get("tenant_slug") ?? ""));
  const programSlug = normalizeTenantSlug(String(formData.get("program_slug") ?? ""));
  const email = buildEmail(formData);
  if (!email) redirect(`${tenantPath("/signup", tenantSlug, programSlug)}?error=Enter%20a%20valid%20email.`);
  const password = String(formData.get("password"));
  const displayName = String(formData.get("displayName"));
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName, organization_slug: tenantSlug || undefined, program_slug: programSlug || undefined } }
  });
  if (error) redirect(`${tenantPath("/signup", tenantSlug, programSlug)}?error=${encodeURIComponent(error.message)}`);
  if (!data.session) redirect(`/login?message=${encodeURIComponent("Check your email to confirm your account, then log in.")}`);
  redirect("/join?requested=1");
}

export async function requestMembershipAction(formData: FormData): Promise<void> {
  const tenantSlug = normalizeTenantSlug(String(formData.get("tenant_slug") ?? ""));
  const programSlug = normalizeTenantSlug(String(formData.get("program_slug") ?? ""));
  if (!tenantSlug) redirect("/join?error=organization_required");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("request_membership_for_slug", {
    p_organization_slug: tenantSlug,
    p_program_slug: programSlug || null
  });
  if (error) redirect(`${tenantPath("/signup", tenantSlug, programSlug)}?error=${encodeURIComponent(error.message)}`);
  redirect("/join?requested=1");
}

export async function logoutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  const cookieStore = await cookies();
  cookieStore.delete("active_organization_slug");
  cookieStore.delete("active_program_slug");
  cookieStore.delete("active_program_organization_slug");
  redirect("/login");
}

export async function setDefaultContextAction(formData: FormData): Promise<void> {
  const organizationId = String(formData.get("organization_id") ?? "");
  const programId = String(formData.get("program_id") ?? "") || null;
  if (!organizationId) throw new Error("Organization is required.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_my_default_context", {
    p_organization_id: organizationId,
    p_program_id: programId
  });
  if (error) throw new Error(error.message);
  const [{ data: organization }, { data: program }] = await Promise.all([
    supabase.from("organizations").select("slug").eq("id", organizationId).single(),
    programId ? supabase.from("programs").select("slug").eq("id", programId).eq("organization_id", organizationId).single() : Promise.resolve({ data: null })
  ]);
  if (!organization?.slug) throw new Error("Default organization was not found.");
  const cookieStore = await cookies();
  cookieStore.set("active_organization_slug", organization.slug, { path: "/", sameSite: "lax" });
  if (program?.slug) {
    cookieStore.set("active_program_slug", program.slug, { path: "/", sameSite: "lax" });
    cookieStore.set("active_program_organization_slug", organization.slug, { path: "/", sameSite: "lax" });
  } else {
    cookieStore.delete("active_program_slug");
    cookieStore.delete("active_program_organization_slug");
  }
  redirect(tenantPath("/dashboard", organization.slug, program?.slug));
}

function buildEmail(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return email;
  const legacyName = String(formData.get("emailName") ?? "").trim().toLowerCase();
  return /^[a-z0-9._-]+$/.test(legacyName) ? `${legacyName}@ou.soccer` : "";
}

function safeNextPath(value: string) {
  return /^\/invite\/[a-zA-Z0-9_-]+$/.test(value) ? value : "";
}

async function redirectForMemberships(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>): Promise<never> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data: preferredContextData } = await supabase.rpc("get_my_default_context").maybeSingle();
  const preferredContext = preferredContextData as { organization_slug?: string | null; program_slug?: string | null } | null;
  if (preferredContext?.organization_slug) {
    redirect(tenantPath("/dashboard", preferredContext.organization_slug, preferredContext.program_slug));
  }
  const { data: memberships } = await supabase
    .from("organization_members")
    .select("organization_id,role,organizations!inner(slug)")
    .eq("profile_id", auth.user.id)
    .eq("status", "active")
    .order("created_at");
  if (!memberships?.length) {
    const { data: platformAccount } = await supabase.from("platform_accounts").select("role").eq("profile_id", auth.user.id).maybeSingle();
    redirect(platformAccount ? "/platform/organizations" : "/join");
  }
  if (memberships.length > 1) redirect("/select-context");
  const membership: any = memberships[0];
  const organization = Array.isArray(membership.organizations) ? membership.organizations[0] : membership.organizations;
  let activePrograms: any[] = [];
  if (membership.role === "owner" || membership.role === "admin") {
    const { data: organizationPrograms } = await supabase
      .from("programs")
      .select("id,slug")
      .eq("organization_id", membership.organization_id)
      .eq("status", "active")
      .order("created_at");
    activePrograms = (organizationPrograms ?? []).map((program) => ({ role: "manager", programs: program }));
  } else {
    const { data: programs } = await supabase
      .from("program_members")
      .select("program_id,role,status,programs(slug)")
      .eq("profile_id", auth.user.id)
      .eq("organization_id", membership.organization_id)
      .eq("status", "active");
    activePrograms = programs ?? [];
  }
  if (activePrograms.length > 1) redirect("/select-context");
  const program = activePrograms[0]?.programs;
  const programSlug = Array.isArray(program) ? program[0]?.slug : program?.slug;
  const effectiveRole = activePrograms[0]?.role ?? membership.role;
  const home = effectiveRole === "captain" ? "/sessions" : effectiveRole === "member" || effectiveRole === "player" ? "/public/report" : "/dashboard";
  redirect(tenantPath(home, organization?.slug, programSlug));
}
