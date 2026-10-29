import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

loadLocalEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
const adminName = process.env.SEED_ADMIN_NAME ?? "Admin";

if (!url || !secretKey) {
  throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY before seeding.");
}

const supabase = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });

function loadLocalEnv() {
  for (const fileName of [".env.local", ".env"]) {
    const filePath = resolve(process.cwd(), fileName);
    if (!existsSync(filePath)) continue;

    const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) continue;

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");
      process.env[key] ??= value;
    }
  }
}

async function main() {
  const adminEmail = await resolveAdminEmail();
  const adminId = await ensureAdminUser(adminEmail);
  await clearAppData(adminId);

  const { error } = await supabase.from("profiles").upsert({
    id: adminId,
    display_name: adminName,
    email: adminEmail,
    role: "admin",
    player_id: null
  });
  if (error) throw error;
  await ensurePlatformOwner(adminId);

  console.log(`Seed complete. Admin login: ${adminEmail} / ${adminPassword}`);
}

async function ensurePlatformOwner(adminId: string) {
  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", "ou-soccer")
    .single();
  if (organizationError) throw organizationError;
  const { error: membershipError } = await supabase.from("organization_members").upsert({
    organization_id: organization.id,
    profile_id: adminId,
    role: "owner",
    status: "active"
  }, { onConflict: "organization_id,profile_id" });
  if (membershipError) throw membershipError;
  const { error: platformError } = await supabase.from("platform_accounts").upsert({
    profile_id: adminId,
    role: "platform_owner"
  });
  if (platformError) throw platformError;
}

async function resolveAdminEmail() {
  if (process.env.SEED_ADMIN_EMAIL) return process.env.SEED_ADMIN_EMAIL;

  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) throw error;

  const usersWithEmail = data.users.filter((user) => user.email);
  if (usersWithEmail.length === 1 && usersWithEmail[0].email) {
    console.log(`SEED_ADMIN_EMAIL not set. Promoting existing auth user ${usersWithEmail[0].email} to admin.`);
    return usersWithEmail[0].email;
  }

  if (usersWithEmail.length > 1) {
    throw new Error(
      [
        "SEED_ADMIN_EMAIL is required because multiple Supabase Auth users exist.",
        `Existing auth users: ${usersWithEmail.map((user) => user.email).join(", ")}`,
        "Run again with SEED_ADMIN_EMAIL set to the email you use to log in."
      ].join("\n")
    );
  }

  return "admin@ousoccer.local";
}

async function ensureAdminUser(adminEmail: string) {
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
    user_metadata: { display_name: adminName }
  });

  if (!createError && created.user?.id) return created.user.id;
  if (createError && !/already.*registered/i.test(createError.message)) throw createError;

  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) throw error;

  const existing = data.users.find((user) => user.email?.toLowerCase() === adminEmail.toLowerCase());
  if (!existing) throw new Error(`Admin user ${adminEmail} already exists but could not be found.`);

  const { error: updateError } = await supabase.auth.admin.updateUserById(existing.id, {
    password: adminPassword,
    email_confirm: true,
    user_metadata: { display_name: adminName }
  });
  if (updateError) throw updateError;

  return existing.id;
}

async function clearAppData(adminId: string) {
  const tables = [
    "audit_logs",
    "whatsapp_imports",
    "goals",
    "session_team_players",
    "session_teams",
    "session_player_charges",
    "ledger_entries",
    "dropouts",
    "attendance",
    "payments",
    "sessions",
    "seasons"
  ];

  for (const table of tables) {
    const { error } = await supabase.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) throw error;
  }

  const { error: profileError } = await supabase.from("profiles").delete().neq("id", adminId);
  if (profileError) throw profileError;

  const { error: adminProfileError } = await supabase.from("profiles").update({ player_id: null }).eq("id", adminId);
  if (adminProfileError) throw adminProfileError;

  const { error: playersError } = await supabase.from("players").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (playersError) throw playersError;
}

main();
