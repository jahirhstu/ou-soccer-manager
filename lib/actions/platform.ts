"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../supabase/server";

export async function createOrganizationAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Unauthorized");
  const { data: account } = await supabase.from("platform_accounts").select("role").eq("profile_id", auth.user.id).maybeSingle();
  if (account?.role !== "platform_owner") throw new Error("Only the platform owner can create organizations.");
  const name = String(formData.get("name") ?? "").trim();
  const slug = normalizeSlug(String(formData.get("slug") ?? name));
  if (name.length < 2 || !slug) throw new Error("Organization name and slug are required.");
  const { data: organization, error } = await supabase
    .from("organizations")
    .insert({ name, slug, created_by: auth.user.id, public_reports_enabled: false })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const { error: settingsError } = await supabase.from("organization_settings").insert({ organization_id: organization.id });
  if (settingsError) throw new Error(settingsError.message);
  const { error: memberError } = await supabase.from("organization_members").insert({
    organization_id: organization.id,
    profile_id: auth.user.id,
    role: "owner",
    status: "active"
  });
  if (memberError) throw new Error(memberError.message);
  revalidatePath("/platform/organizations");
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
