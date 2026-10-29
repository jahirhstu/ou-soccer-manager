# Development and main integration

## Compared revisions

- Main: `5fec830` (notification pagination, filtering, and date sorting).
- Development before integration: `8a10cb1` (`origin/develop`).
- Main-only history: 15 commits. Development-only history: 9 commits, including 4 earlier merge commits.
- Integration target: `develop`. Main is not modified. No remote database migration or production data correction is executed.

## Feature comparison

| Area | Development before integration | Main additions brought into development |
| --- | --- | --- |
| Platform administration | Platform Owner and assigned Superadmin authority, organization administration, template management | Preserved |
| Organization onboarding | Atomic organization/program/module setup, first-owner invitation, onboarding audit, invitation digest fix | Preserved |
| Membership and permissions | Pending/active/suspended membership, organization owners/admins, program managers/captains/members, organization-admin-only management actions | Preserved; financial actions adapted to program authority |
| Program architecture | Global templates, tenant template entitlements, concrete programs, runtime modules, module write checks | Preserved; imports and financial rows now derive scope from their selected season/session |
| Routing/context | Tenant/program URLs, context selection, database-backed public/user defaults | Preserved; financial completion redirects keep the current tenant/program |
| Public reporting | Scoped RPCs, public-report module control, separate public payment/balance visibility | Preserved; new streak and notification endpoints scoped too |
| Dashboard finances | Earlier dashboard | Season selection, positive player-credit liability, net club balance, refunds, waivers, signed club carry-forward and reversal history |
| Player money workflows | Payments, waivers | Full/partial refunds, same-program credit/debt carry-forward, player-to-player credit funding, updated histories and CSV |
| Expenses | Earlier expense recording with module checks | Required season, legacy unassigned-expense allocation, club-transfer blocking |
| WhatsApp signup | Earlier parser/import | Explicit player-line payment source fixes, skipped-payment feedback, signup roster visibility before attendance; context checks added during integration |
| Player streaks | Scoped latest-winning streaks | All tied longest-winning-streak holders, exposed through a scoped wrapper |
| Sharing | No image exports | Saved fixture schedule with field/location, podium/standings, combined scorers/assists, match results, teams, filtered Goals & Assists; one image per export |
| Notifications | Earlier unpaginated list | Player/message/status/season filters, pagination, action-date descending with created-date fallback; tenant-specific list and unread count |

## Architectural resolutions

The merge conflicts were in the dashboard, payment entry page, public player report, navigation, and CRUD actions. Resolution retains development's module/organization-admin checks and scoped report calls while bringing in main's features.

Financial SQL now authorizes the actual season's program. Organization owners/admins and assigned program managers can operate when the relevant module is enabled. Inactive players and guests without program registration can still receive or fund the permitted financial workflows. Captains, outsiders, suspended organization memberships, other programs, and disabled modules do not gain financial authority.

Restrictive program policies constrain older permissive organization policies on operational/financial tables. Program managers receive explicit financial policies. The player directory permits selecting guests in their organization; access to those players' balances remains constrained by season/program policies.

The new financial calculations, locks, idempotency IDs, audit events, and same-program transfer restrictions remain intact. Public reports continue to mask balances/payments according to organization settings. Global report functions and the old global notification APIs remain inaccessible to anonymous/authenticated callers; scoped wrappers expose authorized results.

Import confirmation validates the selected season/session against the current program, checks the WhatsApp module, confines player/alias matching to the current organization, and creates seasons with explicit organization/program IDs. Database triggers derive child-row scope from the selected season/session and reject mismatched program/player references. This avoids relying on a user's first/default organization for financial/import records.

The existing parser regression for `Jahir - Payment $30` is fixed by recognizing `payment` as a payment-intent keyword.

## Migration ordering

The branches reused versions 061, 062, 063, 072, 073, 074, and 075 for different migrations. Development already had some of these collisions from earlier merges. A fresh database cannot use duplicate migration versions reliably.

Main's migration names through 080 are preserved. Development-only migrations are sequenced after them so tenant hardening is applied after legacy grants and function replacements:

| Previous development filename | Integrated filename |
| --- | --- |
| 061_platform_onboarding_and_tenant_hardening.sql | 081_platform_onboarding_and_tenant_hardening.sql |
| 062_scoped_public_reports.sql | 082_scoped_public_reports.sql |
| 063_program_authorization.sql | 083_program_authorization.sql |
| 072_scoped_latest_winning_streaks.sql | 084_scoped_latest_winning_streaks.sql |
| 073_database_context_defaults.sql | 085_database_context_defaults.sql |
| 074_organization_onboarding.sql | 086_organization_onboarding.sql |
| 075_fix_invitation_digest_schema.sql | 087_fix_invitation_digest_schema.sql |

Integration migrations:

- `088_integrated_program_finance.sql`: program-aware financial authority and restrictive scope policies.
- `089_integrated_scoped_reports.sql`: scoped streaks, public season resolution, notification privacy, internal finance reports.
- `090_import_program_scope.sql`: import scope, parent-derived program IDs, program-manager import permissions.

**This migration sequence targets a fresh development database. Do not run an automatic `supabase db push` against the previous development database.** Its applied version history may refer to the old filenames and those migrations are not all safe to replay. Inspect `supabase_migrations.schema_migrations` and the installed schema first; choose either a disposable fresh database or a separately reviewed history reconciliation and incremental upgrade. No history repair is performed here. The production repair scripts imported from main contain production-specific UUIDs and are not seed scripts.

## Validation

Final local results: 192 tests passed across 30 files; production build and TypeScript checks passed. No connected database migrations or production repair scripts were run. Authenticated browser acceptance against the new Supabase project remains pending its creation.

- The complete ordered migration chain is executed in disposable PostgreSQL-compatible PGlite, with real RLS policies and `authenticated`/`anon` roles. The harness supplies Supabase's auth schema, extension, roles, and realtime publication.
- Integration coverage includes program-manager refunds and guest credit transfers, same-program carry-forward and club reversal, disabled payment modules, suspended membership, cross-program denial, inherited import scope, scoped public visibility, unique migration versions, and global RPC privilege revocation.
- Existing financial, import, reporting, sharing, notification, parser, and tenant tests are retained and adapted to scoped RPCs.
- Production Next.js build and TypeScript checks are run. These are not a substitute for testing Supabase Auth, PostgREST, concurrent connections, and browser workflows on the new development project.

## What remains unfinished from the development plan

The implemented direction is a reusable program-based platform, but the application is still primarily a soccer application. Templates such as cricket, community events, training, and technical activities are configured; this does not mean complete sport-specific or RSVP/task interfaces exist. Soccer terminology and organization-wide versus program-specific navigation still need a separate product review.

The existing onboarding document defines a manual role acceptance matrix. End-to-end invitation delivery/acceptance, all navigation/direct URL combinations, platform Superadmin assignments, and module toggles still need staging acceptance with separate accounts. The integration tests exercise selected database authority paths, not every original authorization rule or every page.

The existing seed script and auth-user helper are not yet a comprehensive multi-tenant demonstration dataset. That is the next requested phase, not part of this merge. Plan it around at least two organizations, multiple programs/templates, all role/status combinations, repeated player names across tenants, multiple seasons, and representative sessions, payments, refunds, waivers, carry-forwards, transfers, and notifications. Seed only the new disposable development database, using explicit identities and deterministic IDs. Review bootstrap/default-context behavior and seed idempotency before execution.
