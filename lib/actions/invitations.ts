"use server";

import { createHash, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, getCurrentProfile } from "../supabase/server";
import { tenantPath } from "../tenant";

export async function acceptInvitationAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  if (!/^[a-zA-Z0-9_-]{32,}$/.test(token)) redirect("/join?error=invalid_invitation");
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  const { data, error } = await supabase.rpc("accept_invitation", { p_token: token });
  if (error) redirect(`/invite/${token}?error=${encodeURIComponent(error.message)}`);
  const result = data as { organizationId?: string; programId?: string } | null;
  const [{ data: organization }, { data: program }] = await Promise.all([
    supabase.from("organizations").select("slug").eq("id", result?.organizationId ?? "").maybeSingle(),
    result?.programId
      ? supabase.from("programs").select("slug").eq("id", result.programId).maybeSingle()
      : Promise.resolve({ data: null })
  ]);
  redirect(tenantPath("/dashboard", organization?.slug, program?.slug));
}

export async function createInvitationAction(formData: FormData) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin" || !profile.organization_id) throw new Error("Unauthorized");
  const programId = optionalUuid(formData.get("program_id"));
  const organizationRole = optionalValue(formData.get("organization_role"), ["admin", "player"]);
  const programRole = optionalValue(formData.get("program_role"), ["manager", "captain", "member"]);
  if (!organizationRole && !programRole) throw new Error("An invitation role is required.");
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresInHours = Math.min(168, Math.max(1, Number(formData.get("expires_in_hours") ?? 24)));
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("invitations").insert({
    token_hash: tokenHash,
    organization_id: profile.organization_id,
    program_id: programId,
    organization_role: organizationRole,
    program_role: programRole,
    email: String(formData.get("email") ?? "").trim().toLowerCase() || null,
    expires_at: expiresAt,
    max_uses: organizationRole === "admin" || programRole === "manager" || programRole === "captain" ? 1 : Math.max(1, Number(formData.get("max_uses") ?? 1)),
    created_by: profile.id
  });
  if (error) throw new Error(error.message);
  return { token, path: `/invite/${token}` };
}

function optionalUuid(value: FormDataEntryValue | null) {
  const parsed = String(value ?? "");
  return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(parsed) ? parsed : null;
}

function optionalValue<T extends string>(value: FormDataEntryValue | null, allowed: readonly T[]): T | null {
  const parsed = String(value ?? "") as T;
  return allowed.includes(parsed) ? parsed : null;
}
