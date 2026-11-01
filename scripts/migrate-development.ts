import { readFileSync, readdirSync } from "node:fs";
import { parseEnv } from "node:util";
import postgres from "postgres";
import { localDatabase } from "./demo/local-database";
import { fingerprint, schemaDifferences, snapshot } from "./demo/maintenance";

type Migration = { version: string; name: string; file: string; source: string };

async function main() {
  const env = parseEnv(readFileSync(".env.local", "utf8"));
  const inspection = JSON.parse(readFileSync("dev-database.local.json", "utf8"));
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.DATABASE_URL) {
    throw new Error("Missing development database configuration.");
  }

  const apiUrl = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
  const databaseUrl = new URL(env.DATABASE_URL);
  const projectRef = apiUrl.hostname.split(".")[0];
  if (projectRef !== inspection.projectRef
    || (databaseUrl.hostname !== `db.${projectRef}.supabase.co`
      && decodeURIComponent(databaseUrl.username) !== `postgres.${projectRef}`)) {
    throw new Error("Database/API target does not match the latest development inspection.");
  }

  const files = readdirSync("supabase/migrations").filter((file) => /^\d{3}_.+\.sql$/.test(file)).sort();
  const migrations: Migration[] = files.map((file) => {
    const [version, ...name] = file.replace(/\.sql$/, "").split("_");
    return { version, name: name.join("_"), file, source: readFileSync(`supabase/migrations/${file}`, "utf8") };
  });
  if (new Set(migrations.map((migration) => migration.version)).size !== migrations.length) {
    throw new Error("Duplicate migration versions found.");
  }

  const sql = postgres(env.DATABASE_URL, { max: 1, prepare: false, ssl: "require", connect_timeout: 15 });
  const modelDb = await localDatabase();
  try {
    const before = await sql.begin("read only", async (tx) => {
      const current = await snapshot((query) => tx.unsafe(query));
      const history = await tx`select version,name from supabase_migrations.schema_migrations order by version`;
      return { current, history };
    });

    const observedHistory = inspection.migrations as { version: string; name: string }[];
    if (JSON.stringify(before.history) !== JSON.stringify(observedHistory)) {
      throw new Error("Migration history changed since the latest development inspection.");
    }
    if (!before.history.length) throw new Error("This runner requires existing migration history; use the guarded initial upgrade instead.");

    const historyByVersion = new Map(before.history.map(({ version, name }) => [version, name]));
    for (const [version, name] of historyByVersion) {
      const migration = migrations.find((item) => item.version === version);
      if (!migration || migration.name !== name) {
        throw new Error(`Recorded migration ${version} does not match the local migration source.`);
      }
    }
    const latestVersion = before.history.at(-1)!.version;
    const missingHistorical = migrations.filter((migration) =>
      migration.version <= latestVersion && !historyByVersion.has(migration.version));
    if (missingHistorical.length) {
      throw new Error(`Migration history has gaps before ${latestVersion}: ${missingHistorical.map((item) => item.file).join(", ")}`);
    }

    const stageSnapshots = new Map<string, Record<string, unknown>>();
    for (const migration of migrations) {
      await modelDb.exec(migration.source);
      if (migration.version >= latestVersion) {
        stageSnapshots.set(
          migration.version,
          await snapshot(async (query) => (await modelDb.query(query)).rows as Record<string, unknown>[])
        );
      }
    }
    const matchingStages = migrations.filter((migration) => {
      const stage = stageSnapshots.get(migration.version);
      return stage && schemaDifferences(before.current, stage).length === 0;
    });
    const schemaVersion = matchingStages.at(-1)?.version;
    if (!schemaVersion) {
      throw new Error("Development schema does not match its recorded version or a later local migration.");
    }
    const preApplied = migrations.filter((migration) =>
      migration.version > latestVersion && migration.version <= schemaVersion);
    const pending = migrations.filter((migration) => migration.version > schemaVersion);
    const target = stageSnapshots.get(migrations.at(-1)!.version)!;

    if (preApplied.some((migration) => migration.version === "100")) {
      const [{ count }] = await sql`select count(*)::int as count from public.match_player_positions`;
      if (count !== 0) {
        throw new Error("Migration 100 is present in schema but not history; its position data repair needs manual review.");
      }
    }

    const execute = process.argv.includes("--execute");
    const backupConfirmed = process.argv.includes("--backup-confirmed");
    if (execute && !process.argv.includes(`--confirm=${projectRef}:MIGRATE`)) {
      throw new Error(`Explicit confirmation required: --confirm=${projectRef}:MIGRATE`);
    }
    if (execute && !backupConfirmed) {
      throw new Error("Back up the development database first, then pass --backup-confirmed.");
    }
    console.log({
      projectRef,
      execute,
      schemaVersion,
      alreadyAppliedButUnrecorded: preApplied.map(({ file }) => file),
      pendingMigrations: pending.map(({ file }) => file),
      counts: inspection.counts
    });
    if (!preApplied.length && !pending.length) {
      console.log("Development database is up to date.");
      return;
    }
    if (!execute) {
      console.log("Preview only. Back up the development database before executing.");
      return;
    }

    await sql.begin(async (tx) => {
      await tx`set local lock_timeout='10s'`;
      await tx`select pg_advisory_xact_lock(hashtext('development-migration'))`;
      const current = await snapshot((query) => tx.unsafe(query));
      const currentHistory = await tx`select version,name from supabase_migrations.schema_migrations order by version`;
      if (fingerprint(current) !== fingerprint(before.current)
        || JSON.stringify(currentHistory) !== JSON.stringify(before.history)) {
        throw new Error("Development database changed during migration preflight.");
      }
      for (const migration of preApplied) {
        await tx`
          insert into supabase_migrations.schema_migrations(version,name,statements)
          values (${migration.version},${migration.name},${tx.array([migration.source])})
        `;
      }
      for (const migration of pending) {
        await tx.unsafe(migration.source);
        await tx`
          insert into supabase_migrations.schema_migrations(version,name,statements)
          values (${migration.version},${migration.name},${tx.array([migration.source])})
        `;
      }
      const remaining = schemaDifferences(await snapshot((query) => tx.unsafe(query)), target);
      if (remaining.length) throw new Error(`Post-migration schema verification failed: ${remaining.join("; ")}`);
    });
    console.log(`Applied ${pending.length} development migration(s) and verified the current schema.`);
  } finally {
    await modelDb.close();
    await sql.end({ timeout: 2 });
  }
}

main().catch((error) => {
  console.error(error.code ? `Development migration failed (${error.code}).` : error.message);
  process.exitCode = 1;
});
