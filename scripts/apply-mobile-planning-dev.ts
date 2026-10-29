import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import postgres from "postgres";

async function main() {
  const env = parseEnv(readFileSync(".env.local", "utf8"));
  const ref = "vnmloamscqaqmagimfmz";
  if (!env.DATABASE_URL || !env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("Missing development configuration");
  const url = new URL(env.DATABASE_URL);
  if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== `${ref}.supabase.co` ||
    (url.hostname !== `db.${ref}.supabase.co` && decodeURIComponent(url.username) !== `postgres.${ref}`)) throw new Error("Development target mismatch");
  const migration = readFileSync("supabase/migrations/095_mobile_session_planning.sql", "utf8");
  const sql = postgres(env.DATABASE_URL, { ssl: "require", max: 1, prepare: false, connect_timeout: 15 });
  try {
    await sql.begin(async tx => {
      await tx`set local statement_timeout='30s'`;
      const existing = await tx`select version from supabase_migrations.schema_migrations where version='095'`;
      if (existing.length) throw new Error("Migration 095 already recorded; inspect before reapplying");
      await tx.unsafe(migration);
      await tx`insert into supabase_migrations.schema_migrations(version,name,statements) values('095','mobile_session_planning',${[migration]})`;
      await tx`notify pgrst,'reload schema'`;
    });
    console.log("Development migration 095 applied. Production was not accessed.");
  } finally { await sql.end({ timeout: 2 }); }
}
main().catch(() => { console.error("Development migration failed; transaction rolled back. Check connectivity and migration history."); process.exitCode=1; });
