import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "./env";

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
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError) return { authError: authError.message };
  if (!auth.user) return null;
  const { data, error } = await supabase.from("profiles").select("*").eq("id", auth.user.id).maybeSingle();
  if (error) return { authUserEmail: auth.user.email, profileError: error.message };
  if (data) return withCurrentOrganization(supabase, data);

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

  await supabase.rpc("ensure_default_membership", {
    p_player_id: null,
    p_profile_id: auth.user.id,
    p_role: "player"
  });

  return withCurrentOrganization(supabase, created);
}

async function withCurrentOrganization(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  profile: any
) {
  const { data: member } = await supabase
    .from("organization_members")
    .select("organization_id,role,player_id,organizations(name,slug)")
    .eq("profile_id", profile.id)
    .order("created_at")
    .limit(1)
    .maybeSingle();

  if (!member) {
    await supabase.rpc("ensure_default_membership", {
      p_player_id: profile.player_id,
      p_profile_id: profile.id,
      p_role: profile.role ?? "player"
    });
    const { data: createdMember } = await supabase
      .from("organization_members")
      .select("organization_id,role,player_id,organizations(name,slug)")
      .eq("profile_id", profile.id)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    return attachOrganization(profile, createdMember);
  }

  return attachOrganization(profile, member);
}

function attachOrganization(profile: any, member: any) {
  const organization = Array.isArray(member?.organizations) ? member.organizations[0] : member?.organizations;
  const role = profile.role === "admin" ? "admin" : member?.role === "owner" ? "admin" : member?.role ?? profile.role;
  return {
    ...profile,
    role,
    player_id: member?.player_id ?? profile.player_id,
    organization_id: member?.organization_id ?? null,
    organization_name: organization?.name ?? null,
    organization_slug: organization?.slug ?? null
  };
}
