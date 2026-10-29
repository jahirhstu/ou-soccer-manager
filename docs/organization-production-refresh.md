# Organization Production Refresh

## Scope

This is an opt-in **production-to-development replacement**, not a merge and not
a bank/payment operation. The dashboard is available only to an active organization
owner/admin in the pinned development project. Platform ownership or program-manager
status alone does not grant this permission. The selected organization comes from
the authenticated request context, never a browser-supplied source/destination URL.

Included: players, seasons, sessions, attendance, games, scores, lineups, leagues,
payments, charges, ledger entries, refunds/transfers, expenses, notifications,
imports, aliases, performance ratings, team drafts and organization audit records.
Every program in that organization is included, regardless of dashboard season filter.

Preserved: Auth accounts/passwords, profiles, organization/program memberships,
invitations, platform access, organization settings, program definitions/modules,
other organizations and refresh-job history. No accounts or programs are provisioned.
The organization UUID must match between environments. Missing account/program
dependencies, including deletion of a player still referenced by a preserved
membership, cause rollback. Operators must resolve such mappings explicitly.

No schema migrations run from the dashboard. Schema mismatches fail closed.
Apply reviewed development migrations separately. Historical null program IDs are
derived from their existing session/season; money and transaction IDs are unchanged.
The reviewed table manifest must be updated when application tables are added.

## Deployment

**Not enabled by default. No hosted migrations or data refreshes have been run.**
Migration `092_development_organization_refresh.sql` is pending.

1. Apply migration 092 to development. It creates a job queue and configuration
   table but no enabled targets. It is safe to include in the schema on production
   only while leaving targets empty; never configure or run a worker there.
2. Host `pnpm db:refresh-worker` on a trusted Node.js worker with persistent private
   storage and database network access, outside Vercel request execution. A
   scheduler can invoke it every minute; each invocation processes one job.
3. Use direct or **session** pooler connections on port 5432, not transaction
   pooler connections: the worker holds a session advisory lock. Only one worker
   may process jobs at a time. Table locks protect the short replacement transaction.
4. Configure secrets in the worker's secret store, not Git or public env variables.
   Do not reuse the earlier privileged production rehearsal credential.
5. Stop development writers and outbound integrations during refresh windows.
   Set `REFRESH_WRITERS_STOPPED=true` only after doing so. This is an operator
   attestation, not an automatic shutdown of integrations. Leave the admin dashboard
   reachable. The worker refuses to run without it.
6. Enable an explicitly reviewed organization in development with the SQL below.

Web deployment variables (development only):

```dotenv
APP_ENVIRONMENT=development
ENABLE_PRODUCTION_REFRESH=true
NEXT_PUBLIC_SUPABASE_URL=https://vnmloamscqaqmagimfmz.supabase.co
```

Worker variables, in addition to those three:

```dotenv
REFRESH_PRODUCTION_DATABASE_URL=<dedicated production SELECT-only connection>
REFRESH_DEVELOPMENT_DATABASE_URL=<development restore connection>
REFRESH_BACKUP_DIRECTORY=<absolute private persistent directory outside repository>
REFRESH_WRITERS_STOPPED=true
```

The worker does not load `.env.production.local` or `.env.local`; supply its
environment explicitly through the worker host. Source and target identities are
pinned in code. Reversing URLs, using the same project or targeting another host
is rejected. The web server never needs the production credential.

The production credential needs SELECT on the reviewed `refreshTables` list in
`lib/production-refresh.ts` and `organizations`, plus normal PostgreSQL catalog
visibility. A DBA must provide a dedicated SELECT-only **BYPASSRLS** role.
RLS-filtered snapshots are refused: an incomplete export must never be interpreted
as production deletions. The source connection also sets `row_security=off` so a
loss of bypass privileges causes an error instead of silently filtering records.
It must have no administrative role membership,
no CREATE ROLE/DATABASE rights and no table INSERT/UPDATE/DELETE/TRUNCATE rights.
Set its default transaction mode to read-only too. The worker checks those rights,
enforces read-only connections/transactions, and executes only SELECT/catalog
queries on production. It does not need SELECT on production Auth tables or password
hashes. Source-side grants/role creation require separate DBA authorization.

The development restore account needs unfiltered (BYPASSRLS) read/write access to application tables,
table-lock privileges, read access to Auth users/identities for preservation hashes,
and permission to set `session_replication_role`. Give this credential only to the
isolated worker. It is powerful: the worker suppresses business-trigger side effects
and cascades during replacement, then explicitly verifies foreign keys, organization
scope, restored data, and protected-table hashes before committing.

Enable only in the **development SQL editor**, after worker setup:

```sql
insert into public.development_refresh_targets
  (organization_id, enabled, source_ref, target_ref)
values
  ('bc8032b0-1ce1-4f2c-93d1-df439a815274', true,
   'uqntqbcimkyoiptvtrem', 'vnmloamscqaqmagimfmz')
on conflict (organization_id) do update set enabled = true;
```

To disable, set `enabled=false` and disable the web feature flag. Authorization
is checked when queuing, confirming, claiming and applying. A flag alone does not
replace the database authorization check. Never enable targets on production.

## Workflow

1. Dashboard > Refresh From Production > Analyze Changes.
2. Worker reads a consistent production snapshot and development baseline, checks
   schema compatibility, and stores a private preview file. The snapshot is fixed
   at analysis time, not the later confirmation time. Preview expires in 30 minutes.
3. Admin reviews per-table counts and explicitly confirms replacement.
4. Worker verifies the saved snapshot hash, authorization, expiry and unchanged
   development baseline; backs up current organization data; replaces records in
   one transaction; checks exact JSON/numeric values and preservation hashes; and
   commits data plus job success atomically. A failed check rolls everything back.
5. Dashboard polls job history. It never downloads production records or credentials.

If development changes after analysis, analyze again. Queue delays or a stopped
worker leave requests queued; the dashboard does not execute work itself. A worker
restart marks interrupted analysis/apply jobs failed instead of silently retrying.
If an apply committed, its success marker committed in the same transaction.

Backups/preview files contain private financial and player data. Directories use
0700 and files 0600. Keep the storage encrypted, access-controlled and backed up;
set an operator retention policy. Do not publish these files. The 50 MB snapshot
limit is deliberate; larger datasets require a separately reviewed streaming design.

## Recovery

Keep writers stopped. An operator can restore a job's pre-refresh organization
snapshot using the same fixed development target and private backup directory:

```sh
pnpm db:refresh-worker --recover=JOB_UUID --confirm-recovery=vnmloamscqaqmagimfmz
```

Recovery first backs up current organization data. It validates the recovery file,
restores exact original scope/data without historical normalization, verifies
accounts/configuration/other organizations unchanged and adds a recovery audit.
It overwrites any later development changes in that organization. It is not an
admin dashboard action. Maintain the SELECT-only production connection configuration
for the worker's startup checks even during recovery.

## Validation

`lib/tests/organization-refresh.test.ts` exercises the full migration chain with
three organizations and eight programs, including financial/gameplay scenarios.
It checks environment/direction guards, selected-organization replacement,
development-only row removal, repeatability, protected-account/other-organization
hashes, missing-dependency rollback, schema mismatches, organization-admin-only
access, opt-in, duplicate jobs, confirmation, expiry, cancellation and read RLS.

Before enabling on hosted development, test the scheduled worker, private backup
storage, shutdown controls and a complete preview/confirm/recovery cycle there.
These deployment checks cannot be completed without configuring the dedicated
production read credential and worker host.

Local verification on 2026-10-26: the full 209-test suite passed; the final refresh
suite passed all eight tests after adding the source-credential guard. TypeScript
and the optimized Next.js build passed. Playwright verified the dashboard dialog
at 1440px and 390px widths, including no horizontal overflow and Escape dismissal.
Those browser checks did not request a data refresh. Hosted worker execution,
scheduling and recovery still require the deployment acceptance cycle above.
