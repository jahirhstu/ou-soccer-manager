"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasPermission } from "../permissions";
import { createSupabaseAdminClient } from "../supabase/admin";
import { createSupabaseServerClient, getCurrentProfile } from "../supabase/server";

const orgRoles = ["owner", "admin", "player"] as const;
const membershipStatuses = ["pending", "active", "rejected", "suspended"] as const;

const cleanupTables = [
  "whatsapp_imports",
  "league_team_players",
  "league_matches",
  "league_teams",
  "leagues",
  "goals",
  "session_team_lineups",
  "session_matches",
  "session_team_players",
  "session_teams",
  "session_player_charges",
  "ledger_entries",
  "dropouts",
  "attendance",
  "payments",
  "sessions",
  "seasons",
  "playgrounds",
  "player_aliases",
  "players"
] as const;

export async function updateOrganizationUser(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!hasPermission(profile?.role, "manage_all")) throw new Error("Unauthorized");
  if (!profile?.organization_id) throw new Error("No organization found for this account.");

  const memberId = String(formData.get("member_id") ?? "");
  const role = String(formData.get("role") ?? "");
  const playerIdValue = String(formData.get("player_id") ?? "");
  const playerId = playerIdValue ? playerIdValue : null;
  const status = String(formData.get("status") ?? "active");
  if (!memberId || !isOrgRole(role) || !membershipStatuses.includes(status as (typeof membershipStatuses)[number])) throw new Error("Invalid user update.");

  const supabase = await createSupabaseServerClient();
  const { data: member, error: memberError } = await supabase
    .from("organization_members")
    .select("id,profile_id,role,organization_id")
    .eq("id", memberId)
    .eq("organization_id", profile.organization_id)
    .single();
  if (memberError) throw new Error(memberError.message);

  if (member.role === "owner" && role !== "owner") {
    const { count, error: ownerCountError } = await supabase
      .from("organization_members")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", profile.organization_id)
      .eq("role", "owner");
    if (ownerCountError) throw new Error(ownerCountError.message);
    if ((count ?? 0) <= 1) throw new Error("Every organization needs at least one owner.");
  }

  const { error: updateMemberError } = await supabase
    .from("organization_members")
    .update({ player_id: playerId, role, status })
    .eq("id", memberId)
    .eq("organization_id", profile.organization_id);
  if (updateMemberError) throw new Error(updateMemberError.message);

  const { error: updateProfileError } = await supabase.from("profiles").update({ player_id: playerId }).eq("id", member.profile_id);
  if (updateProfileError) throw new Error(updateProfileError.message);

  revalidatePath("/users");
}

export async function updateOrganizationUserPassword(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!hasPermission(profile?.role, "manage_all")) throw new Error("Unauthorized");
  if (!profile?.organization_id) throw new Error("No organization found for this account.");

  const memberId = String(formData.get("member_id") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!memberId) throw new Error("Invalid user update.");
  if (!password.trim()) return;
  if (password.length < 6) throw new Error("Password must be at least 6 characters.");

  const supabase = await createSupabaseServerClient();
  const { data: member, error: memberError } = await supabase
    .from("organization_members")
    .select("id,profile_id,organization_id")
    .eq("id", memberId)
    .eq("organization_id", profile.organization_id)
    .single();
  if (memberError) throw new Error(memberError.message);
  if (!member?.profile_id) throw new Error("No auth user is linked to this organization member.");

  const adminSupabase = createSupabaseAdminClient();
  const { error } = await adminSupabase.auth.admin.updateUserById(member.profile_id, { password });
  if (error) throw new Error(error.message);

  revalidatePath("/users");
}

export async function cleanupClubData(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!hasPermission(profile?.role, "manage_all")) throw new Error("Unauthorized");
  if (!profile?.organization_id) throw new Error("No organization found for this account.");

  const confirmation = String(formData.get("confirmation") ?? "").trim();
  if (confirmation !== "CLEANUP") {
    redirect("/settings?cleanup=confirmation-required");
  }

  const supabase = await createSupabaseServerClient();

  const { error: memberError } = await supabase
    .from("organization_members")
    .update({ player_id: null })
    .eq("organization_id", profile.organization_id)
    .not("player_id", "is", null);
  if (memberError) throw new Error(memberError.message);

  const { data: memberProfiles, error: memberProfileError } = await supabase
    .from("organization_members")
    .select("profile_id")
    .eq("organization_id", profile.organization_id);
  if (memberProfileError) throw new Error(memberProfileError.message);

  const profileIds = (memberProfiles ?? []).map((member) => member.profile_id);
  if (profileIds.length) {
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ player_id: null })
      .in("id", profileIds);
    if (profileError) throw new Error(profileError.message);
  }

  for (const table of cleanupTables) {
    const { error } = await supabase.from(table).delete().eq("organization_id", profile.organization_id);
    if (error) throw new Error(`Could not clean ${table}: ${error.message}`);
  }

  revalidatePath("/");
  redirect("/settings?cleanup=success");
}

export async function updatePublicReportSettings(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!hasPermission(profile?.role, "manage_all") || !profile?.organization_id) throw new Error("Unauthorized");
  const supabase = await createSupabaseServerClient();
  const reportsEnabled = formData.get("public_reports_enabled") === "on";
  const balancesEnabled = formData.get("public_balances_enabled") === "on";
  const paymentsEnabled = formData.get("public_payments_enabled") === "on";
  const { error: organizationError } = await supabase.from("organizations").update({ public_reports_enabled: reportsEnabled }).eq("id", profile.organization_id);
  if (organizationError) throw new Error(organizationError.message);
  const { error: settingsError } = await supabase.from("organization_settings").upsert({
    organization_id: profile.organization_id,
    public_balances_enabled: balancesEnabled,
    public_payments_enabled: paymentsEnabled
  }, { onConflict: "organization_id" });
  if (settingsError) throw new Error(settingsError.message);
  revalidatePath("/settings");
  revalidatePath("/public/report");
}

export async function setProgramModule(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!hasPermission(profile?.role, "manage_all") || !profile?.organization_id) throw new Error("Unauthorized");
  const programId = String(formData.get("program_id") ?? "");
  const moduleKey = String(formData.get("module_key") ?? "");
  const enabled = String(formData.get("enabled") ?? "false") === "true";
  if (!programId || !/^[a-z0-9_]+$/.test(moduleKey)) throw new Error("Invalid module update.");
  const supabase = await createSupabaseServerClient();
  const { data: program } = await supabase.from("programs").select("id").eq("id", programId).eq("organization_id", profile.organization_id).maybeSingle();
  if (!program) throw new Error("Program not found.");
  const { error } = await supabase.from("program_modules").upsert({
    organization_id: profile.organization_id,
    program_id: programId,
    module_key: moduleKey,
    enabled
  }, { onConflict: "program_id,module_key" });
  if (error) throw new Error(error.message);
  revalidatePath("/programs");
}

function isOrgRole(value: string): value is typeof orgRoles[number] {
  return orgRoles.includes(value as typeof orgRoles[number]);
}
