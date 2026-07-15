import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { getSupabaseEnv } from "./env";
import type { UserRole } from "../types";

export type MobileActor = {
  user: User;
  profileId: string;
  role: UserRole;
  playerId: string | null;
  organizationId: string;
};

export async function authenticateMobileRequest(request: Request, organizationId?: string | null) {
  const token = bearerToken(request);
  if (!token) throw new MobileApiError("Authentication required.", 401);
  const { url, publishableKey } = getSupabaseEnv();
  const supabase = createClient(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data: auth, error: authError } = await supabase.auth.getUser(token);
  if (authError || !auth.user) throw new MobileApiError("Your session is invalid or expired.", 401);

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,role,player_id")
    .eq("id", auth.user.id)
    .single();
  if (profileError) throw new MobileApiError(profileError.message, 403);

  let membershipQuery = supabase
    .from("organization_members")
    .select("organization_id,role,player_id")
    .eq("profile_id", auth.user.id);
  if (organizationId) membershipQuery = membershipQuery.eq("organization_id", organizationId);
  const { data: membership, error: membershipError } = await membershipQuery.order("created_at").limit(1).maybeSingle();
  if (membershipError || !membership) throw new MobileApiError("You do not belong to this organization.", 403);
  const role: UserRole = profile.role === "admin" || membership.role === "owner"
    ? "admin"
    : (membership.role ?? profile.role) as UserRole;

  return {
    supabase,
    actor: {
      user: auth.user,
      profileId: profile.id,
      role,
      playerId: membership.player_id ?? profile.player_id,
      organizationId: membership.organization_id
    } satisfies MobileActor
  };
}

export function requireMobileRole(actor: MobileActor, allowed: UserRole[]) {
  if (!allowed.includes(actor.role)) throw new MobileApiError("You are not allowed to perform this action.", 403);
}

export function mobileApiErrorResponse(error: unknown) {
  if (error instanceof MobileApiError) return Response.json({ error: error.message }, { status: error.status });
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  return Response.json({ error: message }, { status: 500 });
}

export class MobileApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

export type MobileSupabaseClient = SupabaseClient;
