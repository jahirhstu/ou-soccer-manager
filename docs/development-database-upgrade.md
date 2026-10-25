# Upgrade, Clean, and Seed the Existing Development Database

These scripts are **development-only**. They were prepared for the database
inspected from this workspace's `.env.local`, not for production. No remote
migration, cleanup, or seeding was performed during preparation.

## Inspection Results

The read-only inspection found 18 Auth users, 44 players, three sessions, and
zero Storage objects. Supabase migration history was empty. The schema closely
matches the pre-merge development commit `8a10cb1`, with additional manual drift:

- Five missing attribution foreign keys on aliases, charges, team players,
  team-update events, and teams. All five currently have zero orphan references.
- Missing `submit_payment_sent_notification` function.
- Old player statistics aggregation, legacy latest-winner calculation, and a
  different latest-winning-streak definition.
- Missing refunds/carry-forward/player-transfer/club-transfer schema and RPCs,
  credit views, and the integrated program-level permission/scope updates.
- Four extra columns: `players.avatar_url`, `session_teams.score`, and
  `sessions.team_a_score` / `sessions.team_b_score`. These are retained; removing
  them is unnecessary for compatibility and would destroy their existing values.

The upgrade restores the missing foreign keys and winner function, reapplies
049, 068, 070-080, then applies 088-090. It does **not** replay the already-installed
081-087 architecture migrations. Report function privileges are tightened again
before commit. Existing rows are not deleted by the upgrade; historical backfills
in the included migrations may update their derived links/scope.

The inspection covers public tables, column types/defaults/nullability, constraints,
indexes, views, functions, function execute permissions for application roles,
RLS policies, and public/custom Auth-user triggers. It is not a backup or an audit
of all Supabase-managed schemas, custom roles, Storage policies, external services,
or project dashboard settings.

## Files

- `scripts/generated/dev-upgrade.sql`: reviewable upgrade SQL.
- `scripts/generated/dev-cleanup.sql`: destructive application reset SQL.
- `scripts/generated/dev-maintenance.local.json`: ignored project-specific guard,
  schema fingerprint, expected schema, and SQL/source checksums.
- `scripts/dev-database.ts`: guarded preview/execution runner.
- `scripts/seed-demo.ts`: existing fresh seed, now also supporting the inspected
  development target explicitly.

Run through the TypeScript runner, **not by pasting the generated SQL alone into
the SQL Editor**. The runner provides project guards, transactions, and postchecks.
The cleanup SQL alone does not delete Auth accounts.

## Before You Run

1. Verify the Supabase project reference in `.env.local` really is development.
2. Back up the development database, including Auth, and retain that backup
   outside the repository. A schema snapshot is not a data backup.
3. Put the development website in maintenance mode. Stop background jobs,
   imports, signups, and other writers for the entire upgrade/cleanup/seed window.
4. Keep production credentials out of this environment. Never change the main
   branch or production deployment variables for this procedure.
5. Install dependencies with `pnpm install`.

`.env.local` must contain `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and
`SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`). Database and API targets
must match the project stored in the reviewed local plan.

## Commands

Replace `PROJECT_REF` below with the inspected development project reference.
These commands work in PowerShell, Ubuntu, and macOS shells.

Preview the upgrade first (read-only):

```sh
pnpm db:dev upgrade
```

After reviewing the SQL and your backup, explicitly execute it:

```sh
pnpm db:dev upgrade --execute --confirm=PROJECT_REF:UPGRADE
pnpm db:dev verify
```

The upgrade runs in one database transaction. It checks its starting fingerprint,
verifies the final schema, and only then records the current migration baseline.
The original database had no migration records; the recorded history is an
**equivalent-schema baseline**, not a claim that every historical migration was
executed individually against this database. Keep this guide with that record.

Preview and then execute the destructive cleanup:

```sh
pnpm db:dev cleanup
pnpm db:dev cleanup --execute --confirm=PROJECT_REF:CLEANUP --backup-confirmed
```

Cleanup removes **every public application row**: players, profiles, organizations,
programs, seasons, sessions, scores, financial history, memberships, imports,
notifications, and audit history. It restores only the canonical module catalog,
program templates, and template/module mappings from a clean migration build.
It then deletes all Auth users through Supabase Admin API, including your existing
development administrator. New login accounts will be supplied by the demo seed.

No schemas, tables, RLS policies, functions, or migration history are dropped.
TRUNCATE uses an explicit reviewed table list without CASCADE; unexpected external
foreign-key dependencies block it. Storage objects block execution rather than
being silently deleted. Bucket configuration and non-application Supabase service
data/settings are not reset.

Create `.env.seed.local` with at least:

```env
SEED_USER_PASSWORD=YOUR_STRONG_DEVELOPMENT_ONLY_PASSWORD
SEED_EMAIL_DOMAIN=demo.example.test
SEED_WEBSITE_URL=http://localhost:3003
```

Then seed using the already-inspected `.env.local` target:

```sh
pnpm seed:demo --use-development-env --confirm=PROJECT_REF:SEED
pnpm db:dev verify
```

Do not use `--migrate` here: the upgrade already installed the schema.
Do not use the legacy `pnpm seed` command.
The seed checks schema compatibility and refuses remaining business data or
non-demo Auth users. Login emails and links are written to the ignored
`seed-demo-manifest.local.json`; use the password you supplied. See
[the demo dataset guide](demo-seed.md) for expected balances and test scenarios.

## Recovery and Repetition

- Preview is the default; only `--execute` plus the exact project/action
  confirmation enables writes.
- If schema/source/SQL checksums change, stop. Do not bypass the guards. Inspect
  the changes and prepare a new reviewed plan.
- Upgrade errors roll back the database transaction. After success, repeating
  upgrade reports that the schema is already current.
- Cleanup's application SQL is transactional. Auth deletion is a separate API
  phase and cannot roll back with it. If Auth deletion fails, keep the app offline
  and rerun cleanup with the same explicit confirmation. Do not seed mid-cleanup.
- After cleanup, recovery of deleted data requires your backup. There is no
  automatic undo script or reverse migration pretending to recover lost data.
- Successful seeding is a no-op on repetition, preserving subsequent manual tests.
  Running cleanup again deliberately deletes those tests and all demo accounts.

`pnpm db:inspect:dev` performs the read-only inspection. `pnpm db:prepare:dev`
generates artifacts locally from that snapshot and repository SQL; it is tailored
to this inspected pre-merge schema, not a general automatic migration generator.
Do not regenerate a pre-upgrade plan after the database has already been upgraded.

## Validation and Production Boundary

Automated tests rehearse the old architecture plus missing constraints/function,
apply the upgrade, compare the schema against a fresh development migration chain,
clean the database, seed all demo scenarios, and repeat cleanup. Actual Supabase
Auth deletion has not been executed; its network behavior still needs validation
when you approve running the maintenance workflow.

**Do not run these reset or seed commands against production.** Production needs
a fresh read-only inspection, data-preserving migration plan, backup/restore
rehearsal, and verification of financial totals and tenant assignments. This
development plan is not automatically applicable to production's migration history.
