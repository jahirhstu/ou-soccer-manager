import { createClient } from "@supabase/supabase-js";

const url = required("SUPABASE_URL");
const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
const organizationId = required("TEST_ORGANIZATION_ID");
const programId = required("TEST_PROGRAM_ID");
const password = required("TEST_USER_PASSWORD");
const domain = process.env.TEST_EMAIL_DOMAIN?.trim() || "example.test";
const prefix = process.env.TEST_EMAIL_PREFIX?.trim() || "auth-test";
const supabase = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

const accounts = [
  { key: "platform-superadmin", name: "Test Platform Superadmin", organizationRole: null, programRole: null, status: "active" },
  { key: "organization-owner", name: "Test Organization Owner", organizationRole: "owner", programRole: "manager", status: "active" },
  { key: "organization-admin", name: "Test Organization Admin", organizationRole: "admin", programRole: "manager", status: "active" },
  { key: "program-manager", name: "Test Program Manager", organizationRole: "player", programRole: "manager", status: "active" },
  { key: "captain", name: "Test Captain", organizationRole: "player", programRole: "captain", status: "active" },
  { key: "member", name: "Test Member", organizationRole: "player", programRole: "member", status: "active" },
  { key: "suspended", name: "Test Suspended Member", organizationRole: "player", programRole: "member", status: "suspended" },
  { key: "outsider", name: "Test Outsider", organizationRole: null, programRole: null, status: "active" }
] as const;

async function main() {
  for (const account of accounts) {
    const email = `${prefix}+${account.key}@${domain}`;
    const userId = await ensureAuthUser(email, account.name);
    await must(supabase.from("profiles").upsert({
      id: userId,
      email,
      display_name: account.name,
      role: "player"
    }, { onConflict: "id" }), `profile ${email}`);

    if (account.key === "platform-superadmin") {
      await must(supabase.from("platform_accounts").upsert({
        profile_id: userId,
        role: "platform_superadmin"
      }), `platform account ${email}`);
      await must(supabase.from("platform_admin_organization_access").upsert({
        profile_id: userId,
        organization_id: organizationId
      }), `platform access ${email}`);
    }

    if (account.organizationRole) {
      await must(supabase.from("organization_members").upsert({
        organization_id: organizationId,
        profile_id: userId,
        role: account.organizationRole,
        status: account.status
      }, { onConflict: "organization_id,profile_id" }), `organization membership ${email}`);
    }

    if (account.programRole) {
      const { data: existing } = await supabase
        .from("program_members")
        .select("id")
        .eq("program_id", programId)
        .eq("profile_id", userId)
        .maybeSingle();
      const operation = existing
        ? supabase.from("program_members").update({ role: account.programRole, status: account.status }).eq("id", existing.id)
        : supabase.from("program_members").insert({
            organization_id: organizationId,
            program_id: programId,
            profile_id: userId,
            role: account.programRole,
            status: account.status
          });
      await must(operation, `program membership ${email}`);
    }

    console.log(`${account.key.padEnd(22)} ${email}`);
  }
}

async function ensureAuthUser(email: string, displayName: string) {
  const { data: listed, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw listError;
  const existing = listed.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
  if (existing) {
    const { error } = await supabase.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName }
    });
    if (error) throw error;
    return existing.id;
  }
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName }
  });
  if (error) throw error;
  return data.user.id;
}

async function must(request: PromiseLike<{ error: { message: string } | null }>, label: string) {
  const { error } = await request;
  if (error) throw new Error(`${label}: ${error.message}`);
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
