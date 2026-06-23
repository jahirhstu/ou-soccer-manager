import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "./env";
import { getRequestProgramSlug, getRequestTenantSlug } from "../tenant-server";

type CookieToSet = {
  name: string;
  value: string;
  options: CookieOptions;
};

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = getSupabaseEnv();

  return createServerClient(
    url,
    publishableKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server Components cannot always write cookies; middleware refreshes sessions.
          }
        }
      }
    }
  );
}

export async function getCurrentProfile(): Promise<any> {
  const supabase = await createSupabaseServerClient();
  const tenantSlug = await getRequestTenantSlug();
  const programSlug = await getRequestProgramSlug();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError) return { authError: authError.message };
  if (!auth.user) return null;
  const { data, error } = await supabase.from("profiles").select("*").eq("id", auth.user.id).maybeSingle();
  if (error) return { authUserEmail: auth.user.email, profileError: error.message };
  if (data) return withCurrentOrganization(supabase, data, tenantSlug, programSlug);

  const displayName =
    typeof auth.user.user_metadata?.display_name === "string"
      ? auth.user.user_metadata.display_name
      : auth.user.email?.split("@")[0] ?? "Player";

  const { data: created, error: createError } = await supabase
    .from("profiles")
    .insert({
      id: auth.user.id,
      display_name: displayName,
      email: auth.user.email,
      role: "player"
    })
    .select("*")
    .single();
  if (createError) {
    return {
      authUserEmail: auth.user.email,
      profileError: `Profile missing and auto-create failed: ${createError.message}`
    };
  }

  return withCurrentOrganization(supabase, created, tenantSlug, programSlug);
}

async function withCurrentOrganization(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  profile: any,
  tenantSlug: string,
  programSlug: string
) {
  let memberQuery = supabase
    .from("organization_members")
    .select(tenantSlug ? "organization_id,role,player_id,organizations!inner(name,slug)" : "organization_id,role,player_id,organizations(name,slug)")
    .eq("profile_id", profile.id)
    .eq("status", "active");

  if (tenantSlug) memberQuery = memberQuery.eq("organizations.slug", tenantSlug);

  let { data: member } = await memberQuery.order("created_at").limit(1).maybeSingle();

  if (!member && tenantSlug) {
    const { data: organization } = await supabase.from("organizations").select("id,name,slug").eq("slug", tenantSlug).maybeSingle();
    if (organization) {
      const { data: platformAccess } = await supabase.rpc("has_platform_organization_access", { p_organization_id: organization.id });
      if (platformAccess === true) member = {
        organization_id: organization.id,
        role: "admin",
        player_id: null,
        organizations: organization
      } as any;
    }
  }

  const attached = attachOrganization(profile, member);
  if (!programSlug || !attached.organization_id) return attached;
  const { data: programMembership } = await supabase
    .from("program_members")
    .select("role,programs!inner(slug)")
    .eq("profile_id", profile.id)
    .eq("organization_id", attached.organization_id)
    .eq("status", "active")
    .eq("programs.slug", programSlug)
    .maybeSingle();
  if (!programMembership || attached.role === "admin") return attached;
  const programRole = programMembership.role === "manager" ? "admin" : programMembership.role === "member" ? "player" : programMembership.role;
  return { ...attached, role: programRole, program_role: programMembership.role };
}

function attachOrganization(profile: any, member: any) {
  const organization = Array.isArray(member?.organizations) ? member.organizations[0] : member?.organizations;
  const role = member?.role === "owner" ? "admin" : member?.role ?? "player";
  return {
    ...profile,
    role,
    player_id: member?.player_id ?? profile.player_id,
    organization_id: member?.organization_id ?? null,
    organization_name: organization?.name ?? null,
    organization_slug: organization?.slug ?? null
  };
}

export async function getCurrentProgram(): Promise<any> {
  const programSlug = await getRequestProgramSlug();
  if (!programSlug) return null;
  const profile = await getCurrentProfile();
  if (!profile?.organization_id) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("programs")
    .select("*")
    .eq("organization_id", profile.organization_id)
    .eq("slug", programSlug)
    .maybeSingle();
  if (error) return { programError: error.message };
  return data;
}
