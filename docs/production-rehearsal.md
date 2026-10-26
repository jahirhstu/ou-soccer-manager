# Production Data Rehearsal

This workflow replaces **development only** with a production snapshot, verifies
the baseline, then upgrades it. Production connections are read-only at both
the driver and `pg_dump` session levels. It never merges or pushes code.

## Requirements

- `.env.production.local`: `PRODUCTION_DATABASE_URL`, `PRODUCTION_SUPABASE_URL`.
- `.env.local`: development `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`.
- PostgreSQL 17 client binaries. Set `PG_BIN` to their directory if it differs
  from `/usr/local/opt/libpq@17/bin` (including on Ubuntu or Windows).
- A protected development deployment with all writers, signups, outgoing emails,
  jobs, and webhooks stopped for the entire restore/upgrade window.

The current implementation deliberately refuses Storage objects, Vault secrets,
MFA, non-email identities, public-schema extensions, partitioned tables, active
database cron jobs, or database webhook triggers. These need a separately reviewed
restore, not silently omitted data. Supabase-managed schemas and project credentials
are retained. Managed Auth columns must match before restore.

## Commands

```sh
pnpm db:rehearse preview
pnpm db:rehearse backup --execute --confirm=DEVELOPMENT_PROJECT_REF
```

Backup creates a new private directory outside the repository and prints its path.
It contains development recovery archives, a consistent production snapshot,
schema manifests, checksums, and migration history. Files containing account data
and password hashes are sensitive; protect and remove them when no longer needed.
Do not upload them to Git, tickets, shared drives, or public artifacts.

Use the printed directory as `RUN_DIRECTORY`:

```sh
pnpm db:rehearse restore-development --run=RUN_DIRECTORY
pnpm db:rehearse restore-development --run=RUN_DIRECTORY --execute --confirm=DEVELOPMENT_PROJECT_REF --isolated
pnpm db:rehearse verify --run=RUN_DIRECTORY
pnpm db:rehearse upgrade-development --run=RUN_DIRECTORY
pnpm db:rehearse upgrade-development --run=RUN_DIRECTORY --execute --confirm=DEVELOPMENT_PROJECT_REF --isolated
pnpm db:rehearse verify --run=RUN_DIRECTORY
```

Quote the full `--run=...` argument if the path has spaces.

Restore is destructive to the existing development application schema and users.
It locks the application tables and verifies the pre-backup row checksums before
replacement. Schema/data loading and source row-count/hash assertions run inside
one `psql` transaction with `ON_ERROR_STOP`. It recreates custom Auth triggers and
Realtime publication membership, and preserves the source migration history.

Supabase-owned `supabase_admin` default-privilege archive entries are excluded:
the project database user cannot recreate them. This affects defaults for future
objects created by that managed role, not the explicit grants on restored tables
or functions. Application objects are restored under the project database user.
This is an application recovery procedure, not a byte-identical managed-project
restore; contact Supabase if managed-role defaults also need restoration.

Only email Auth users and identities are copied. Their UUIDs and password hashes
are preserved; active sessions and pending authentication tokens are not reused.
Users must log in again. No production password or user is modified. Auth service
internal migration tables are never overwritten.

The upgrade requires a verified, unchanged baseline. It applies 081 onward,
including historical scope backfill 091, then the reviewed club configuration.
It preserves existing player links, adds missing program access, restores legacy
captain authority, and sets the existing club/program defaults. It checks protected
historical row hashes and Auth identity/password hashes before commit. Only
`program_id` and update timestamps are excluded from historical-row comparisons;
payments, amounts, scores, IDs, attendance, and dates remain protected.

Migration history is recorded as an equivalent-schema baseline after verification;
the source's empty history is not used as a reason to replay 001-080.

## Recovery

To restore the original development backup:

```sh
pnpm db:rehearse recover-development --run=RUN_DIRECTORY
pnpm db:rehearse recover-development --run=RUN_DIRECTORY --execute --confirm=DEVELOPMENT_PROJECT_REF --isolated --recovery-confirmed
pnpm db:rehearse verify --run=RUN_DIRECTORY
```

Recovery first backs up the current development data, then restores the original
application/identity snapshot. Active login sessions are not restored. Never run
recovery while the app is accepting writes. After verified recovery, repeat
`restore-development` and `upgrade-development` using the same run directory
to rehearse the same snapshot, or start a new backup run for a newer snapshot.
Reuse is allowed only while recovered application and account checksums still
match the original backup.

## Acceptance

Verify the baseline before manual testing. After testing creates new payments,
attendance, notifications, or results, a baseline checksum mismatch is expected:
do not mistake altered test data for migration corruption.

Test login, default routes, historical/public financial reports, existing captains,
members, manager scope, invitations, organization creation, fixture/team sharing,
imports, notifications, refunds and transfers. Record test-created data separately.
Do not run the fresh demo seed: production records are the baseline for this
rehearsal. No production deployment is authorized by running these commands.

Additional verification commands:

```sh
pnpm exec tsx scripts/rehearsal/verify-finances.ts
pnpm exec tsx scripts/rehearsal/verify-refund.ts --confirm=DEVELOPMENT_PROJECT_REF
```

The first command is read-only on both databases and compares all season dashboard
amounts plus a checksum of every player-season balance row. The second exercises
a one-cent refund, idempotency, balance/dashboard changes, insufficient-credit
rejection, and member denial in development, then deliberately rolls back and
compares every application table checksum. Keep writers stopped for these tests.

## Rehearsal Results (2026-10-25)

Production was read only. Work stayed on `develop`; no merge or push was performed.
The production snapshot and original development recovery archives are private,
outside Git, under `~/.local/share/ou-soccer-rehearsal/2026-10-26T00-56-53.705Z`.

The initial production restore and 081-091 upgrade passed schema and historical
row checksums. Account UUID/email/password checksums matched all 37 accounts.
The original development backup was also recovered and verified, then the same
production snapshot was selected again for the final development environment.
The recovery test exposed the managed-role default-privilege restriction described
above; the first failed attempt rolled back without committing partial data.

Financial reconciliation matched every player-season balance and both dashboard
season summaries exactly:

| Measure | Production / Upgraded Development |
| --- | ---: |
| Players | 78 |
| Sessions | 21 |
| Payments | 251 |
| Payments total | $9,882.00 |
| Expenses | $4,085.05 |
| Refunds | $816.00 |
| Positive player credit | $3,742.00 |
| Summer net club balance | $0.00 |
| Fall net club balance | $1,238.95 |

Automated suite: 202 tests passed across 33 files. TypeScript and the optimized
Next.js build passed. These results do not authorize a production deployment;
manual acceptance of organization onboarding, memberships and workflows remains
necessary. Existing ambiguous player/account links were preserved, not guessed.

Final checks on 2026-10-26:

- The second restore and upgrade committed successfully; financial reconciliation
  again matched production exactly.
- The live development refund test passed, including duplicate prevention, exact
  balance/dashboard deltas, insufficient-credit rejection and member denial. All
  test writes rolled back and all application table checksums matched afterward.
- Sixteen browser checks passed across anonymous, owner, captain and member
  contexts. These covered public reports, goals/assists, dashboard, payments,
  notifications, players, session details/summary and payment reporting. Captain
  and member finance routes redirected to their permitted pages.
- Browser authentication used development-only login links without sending email
  or changing passwords. Actual password entry was not tested; copied password
  hashes were verified instead.

For local testing use `pnpm dev --hostname localhost --port 3003` and open
`http://localhost:3003`. Binding this local Next.js instance to `127.0.0.1` while
rewrites used `localhost` caused a redirect loop; matching the hostname resolved it.

The current private `.env.production.local` also contains unprefixed Supabase
keys. Next.js production-mode builds/startup load these ahead of `.env.local`,
which can mix production keys with the development URL. No private environment
files were changed. Before production-mode local testing, supply a consistent
environment or move inspection-only credentials to a file Next.js does not load.
The development-mode browser checks used `.env.local` only. Check Vercel's project
environment variables independently before any deployment.
