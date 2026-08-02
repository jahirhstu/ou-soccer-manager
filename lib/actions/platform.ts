"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../supabase/server";

export type OrganizationOnboardingResult = {
  organizationId: string;
  invitationPath: string;
};

export async function onboardOrganizationAction(formData: FormData): Promise<OrganizationOnboardingResult> {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Unauthorized");

  const programs = parsePrograms(String(formData.get("programs_json") ?? ""));
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  const name = String(formData.get("name") ?? "").trim();
  const slug = normalizeSlug(String(formData.get("slug") ?? name));
  const currencyCode = String(formData.get("currency_code") ?? "CAD").trim().toUpperCase();

  const { data, error } = await supabase.rpc("create_organization_onboarding", {
    p_name: name,
    p_slug: slug,
    p_organization_category: String(formData.get("organization_category") ?? "sports_club"),
    p_currency_code: currencyCode,
    p_timezone: String(formData.get("timezone") ?? "America/Toronto"),
    p_programs: programs,
    p_owner_email: String(formData.get("owner_email") ?? "").trim().toLowerCase(),
    p_owner_token_hash: tokenHash,
    p_owner_expires_at: expiresAt
  });
  if (error) throw new Error(error.message);
  const result = data as { organizationId?: string } | null;
  if (!result?.organizationId) throw new Error("Organization onboarding returned no organization.");

  revalidatePath("/platform/organizations");
  return { organizationId: result.organizationId, invitationPath: `/invite/${token}` };
}

export async function updatePlatformOrganizationAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Unauthorized");
  const organizationId = String(formData.get("organization_id") ?? "");
  const onboardingStatus = String(formData.get("onboarding_status") ?? "");
  if (!["active", "suspended"].includes(onboardingStatus)) throw new Error("Invalid organization status.");
  const { error } = await supabase
    .from("organizations")
    .update({ onboarding_status: onboardingStatus })
    .eq("id", organizationId);
  if (error) throw new Error(error.message);
  revalidatePath(`/platform/organizations/${organizationId}`);
  revalidatePath("/platform/organizations");
}

export async function createProgramTemplateAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Unauthorized");
  const name = String(formData.get("name") ?? "").trim();
  const key = normalizeSlug(String(formData.get("key") ?? name));
  const modules = formData.getAll("modules").map(String).filter((value) => /^[a-z0-9_]+$/.test(value));
  const requiredModules = ["members", "activities"].filter((value) => modules.includes(value));
  const { error } = await supabase.rpc("create_program_template", {
    p_key: key,
    p_name: name,
    p_category: String(formData.get("category") ?? "generic"),
    p_modules: modules,
    p_required_modules: requiredModules
  });
  if (error) throw new Error(error.message);
  revalidatePath("/platform/program-templates");
  revalidatePath("/platform/organizations/new");
}

export async function setOrganizationTemplateAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const organizationId = String(formData.get("organization_id") ?? "");
  const programTemplateId = String(formData.get("program_template_id") ?? "");
  const enabled = String(formData.get("enabled") ?? "true") === "true";
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Unauthorized");
  const { error } = await supabase.from("organization_enabled_programs").upsert({
    organization_id: organizationId,
    program_template_id: programTemplateId,
    enabled,
    enabled_by: auth.user.id
  }, { onConflict: "organization_id,program_template_id" });
  if (error) throw new Error(error.message);
  revalidatePath("/platform/organizations");
}

export async function setPlatformDefaultContextAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const programId = String(formData.get("program_id") ?? "");
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Unauthorized");
  const { data: program, error: programError } = await supabase
    .from("programs")
    .select("organization_id")
    .eq("id", programId)
    .eq("status", "active")
    .single();
  if (programError || !program) throw new Error(programError?.message ?? "Program not found.");
  const { error } = await supabase.rpc("set_platform_default_context", {
    p_organization_id: program.organization_id,
    p_program_id: programId
  });
  if (error) throw new Error(error.message);
  revalidatePath("/platform/organizations");
  revalidatePath("/");
}

export async function assignPlatformSuperadminAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Unauthorized");
  const { data: owner } = await supabase.from("platform_accounts").select("role").eq("profile_id", auth.user.id).maybeSingle();
  if (owner?.role !== "platform_owner") throw new Error("Only the platform owner can assign superadmins.");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const organizationId = String(formData.get("organization_id") ?? "");
  const { data: profile, error: profileError } = await supabase.from("profiles").select("id").eq("email", email).maybeSingle();
  if (profileError || !profile) throw new Error(profileError?.message ?? "User profile not found.");
  if (profile.id === auth.user.id) throw new Error("The platform owner cannot replace their own role.");
  const { error: accountError } = await supabase.from("platform_accounts").upsert({ profile_id: profile.id, role: "platform_superadmin" });
  if (accountError) throw new Error(accountError.message);
  const { error: accessError } = await supabase.from("platform_admin_organization_access").upsert({ profile_id: profile.id, organization_id: organizationId });
  if (accessError) throw new Error(accessError.message);
  revalidatePath("/platform/organizations");
}

function normalizeSlug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function parsePrograms(value: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Program configuration is invalid.");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("Select at least one program template.");
  return parsed.map((program) => {
    if (!program || typeof program !== "object") throw new Error("Program configuration is invalid.");
    const item = program as Record<string, unknown>;
    const templateId = String(item.templateId ?? "");
    const name = String(item.name ?? "").trim();
    const slug = normalizeSlug(String(item.slug ?? name));
    const modules = Array.isArray(item.modules)
      ? item.modules.map(String).filter((moduleKey) => /^[a-z0-9_]+$/.test(moduleKey))
      : [];
    if (!/^[0-9a-f-]{36}$/i.test(templateId) || name.length < 2 || !slug) {
      throw new Error("Every selected template needs a valid program name and slug.");
    }
    return { templateId, name, slug, modules, isDefault: Boolean(item.isDefault) };
  });
}
