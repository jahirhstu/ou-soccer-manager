# Production Release Record

## Database Upgrade Completed

Production migrations 081-095 committed on 2026-10-29 at 17:25 UTC against
project `uqntqbcimkyoiptvtrem`. The user authorized direct production migration
after backup and confirmed a maintenance window. No separate staging restore was
performed. A rollback-only production validation passed before the commit.

The code/schema candidate was `003aa696f63d1a22aad41e6e67f122cd8d0eb095`.
A subsequent independent read-only inspection found no public-schema differences
from migrations through 095.

## Preserved Data And Identity

- All 37 accounts and credential hashes were preserved, along with Auth identities.
- Protected historical record checksums matched, excluding only program scope
  and update timestamps that the reviewed backfill may change.
- All 156 player-season balance rows and both season financial summaries matched.
- Program scope is populated without conflicts in all inspected tables, including
  253 payments, 772 ledger entries, 503 attendance rows and 252 goals.
- Existing profile, organization and program player links were preserved.
- At the user's explicit request, ambiguous additional memberships were created
  without player links. Jahir's existing linked program account remains linked;
  the additional Jahir and both Arif memberships remain unlinked.
- Existing organization captain authority was carried into program roles.
- Migration 081 maps the sole existing organization owner to platform owner.
- Existing effective public financial visibility was preserved. Production did not
  previously have separate balance/payment visibility flags.
- Development refresh remains unconfigured in production.
- Empty migration history was baselined only after schema verification. Migrations
  001-080 were not replayed; 93 migration files exist because numbering has gaps.

## Backup And Evidence

Private backup directory:
`~/.local/share/ou-production-releases/2026-10-29T17-23-43.837Z`

It contains the full custom-format database archive, checksum manifest,
rollback-verification record and committed-migration record. The archive was
listed and fully decoded; restoration has not been tested. Storage contained no
objects when inspected. Database dumps do not contain Storage object bytes.

Independent post-migration report:
`/tmp/ou-production-postmigration-20261029/inspection.json`

Keep these sensitive artifacts outside Git and retain a protected durable copy.
The inspector's 080-baseline warnings are expected after upgrading; the relevant
post-upgrade result is `databases.production.targetDifferences: []`.

## Tooling

- `scripts/production/backup-release.ts`: read-only full database backup.
- `scripts/production/inspect-release.ts`: read-only schema and scope inventory.
- `scripts/production/migrate-release.ts`: guarded baseline-080 upgrade; defaults
  to rollback, requires matching verification and backup for commit.
- `scripts/production/configure-release.sql`: approved membership/default mapping.
- `scripts/production/check-membership-links.ts`: read-only ambiguity inspection.

Do not rerun the migration runner against the upgraded database. It intentionally
rejects the now-changed baseline and populated migration history.

## Application Release

Database completion does not itself deploy the website. Merge the validated
`develop` release into `main`, push, and confirm Vercel production deployment.
Keep maintenance active until public and authenticated smoke checks pass.
Verify production environment variables refer consistently to production, and do
not configure a development refresh worker on the production deployment.

Do not assume reverting code alone reverses permission/schema changes. If new
writes have occurred since the backup, restoring it would discard those writes;
prefer a forward correction or reconcile them before any restore.

## Validation

Release checks on 2026-10-29: all 276 tests across 46 files passed, and the
optimized Next.js build completed with TypeScript checks and 49 static pages.

The focused membership regression test passed: existing links are retained,
ambiguous memberships remain unlinked, clear memberships are linked, and repeating
the configuration does not duplicate memberships. Production transactional and
post-commit checks above passed. Application regression/build results belong to
the release close-out; no device or authenticated browser test is implied by
database checks.
