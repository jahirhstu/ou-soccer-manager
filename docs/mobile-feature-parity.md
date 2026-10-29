# Website To Native Feature Parity

Status: in progress, not complete. This inventory supersedes the earlier
redesign-only exclusions: those features are now in the requested parity scope.
It does not claim that pending native screens exist or provide placeholder buttons.

Session-planning update: see [mobile-session-planning.md](mobile-session-planning.md)
for current native workflows, migration 095 deployment, import API setup and
remaining differences from the website.

## Placement And Authority

OU Sports is for participants and contextual captain/team-member actions.
OU Manager is for program managers, organization administrators, and explicitly
authorized platform administrators. A person can use both apps if authorized.
Installing either app never grants authority. Tenant, program, module, session,
player identity and role checks must remain server-enforced.

Global platform authority must remain distinct from organization ownership and
program management. The current native manager gate requires a manager workspace;
platform-only onboarding needs a separate authenticated platform entry point.
Do not satisfy that requirement by giving platform owners fake program roles.

## Route-Level Inventory

| Website feature/routes | Native destination | Current state |
| --- | --- | --- |
| `/login`, `/signup`, `/join` | Sports Account; Manager sign-in | Basic native auth/membership implemented |
| `/select-context` | Both account/program selectors | Switching implemented; website default-context preferences pending |
| `/invite/[token]` | Both account entry flows | Invitation acceptance/deep links pending |
| `/dashboard` | Manager Dashboard | Partial: previews/actions; financial dashboard totals and season filters pending |
| `/public/sessions`, `/sessions` | Sports Sessions; Manager Program | Native lists implemented; richer filters/details pending |
| `/sessions/new`, `/seasons/new`, `/players/new` | Manager Program | Native create/review forms implemented |
| `/seasons`, `/seasons/[id]` | Manager Program; Sports relevant season details | Lists implemented; full detail/registration workflows pending |
| `/players`, `/players/[id]`, `/players/[id]/edit` | Manager Players; Sports own account | Lists/create implemented; full edit/detail/linking pending |
| `/public/sessions/[id]`, `/sessions/[id]` | Both session details | Saved fixtures/teams/results implemented; attendance and completion available from Session operations; richer detail/charge views pending |
| `/sessions/[id]/scores`, public scores | Sports authorized captains; Manager authorized staff | Native score entry/review implemented |
| `/public/sessions/[id]/summary` | Both session Summary | Added: podium, standings, contributor goals/assists |
| `/public/sessions/[id]/teams` | Both session Teams | Saved rosters implemented |
| `/public/team-builder`, `/sessions/[id]/teams/edit` | Manager session operations; Sports only existing authorized captain scope | Native team/captain assignment, lottery/balanced order, explicit draft save/resume implemented; realtime presence and autosave pending |
| `/sessions/[id]/fixture` | Manager session operations; captain scope if authorized | Atomic native generation implemented; individual fixture row editing pending |
| `/sessions/[id]/lineups` | Sports assigned team members; Manager only as existing policy allows | Native formation, player and coordinate editing implemented; pitch drag-and-drop pending |
| `/attendance` | Manager operations; authorized captains in Sports | Status/notes, roster search, pagination and atomic charge reconciliation implemented; dropout/replacement financial agreements pending |
| `/performance` | Manager; authorized captains in Sports | Native ratings editor for saved session-team players implemented; program-wide directory pending |
| `/payments`, `/payments/new` | Manager Finance | Season payments implemented; session-linked drop-in entry pending |
| `/payments/refund`, `/payments/carry-forward`, player credit transfer | Manager Finance | Native recording/review implemented |
| `/payments/waiver` | Manager Finance | Pending atomic mobile-safe waiver endpoint and form |
| `/expenses`, `/expenses/new` | Manager Finance | Native season expense entry/list implemented; seasonless assignment pending |
| Club balance transfer/reversal on dashboard | Manager Finance | Native preview/history/transfer/reversal pending |
| `/payments/reminders` | Manager Finance | Native reminders/recipient selection pending |
| `/notifications` | Manager organization-admin tools | Native inbox, filtering and acceptance pending |
| Payment-sent notification in `/public/report` | Sports own balance | Native submission pending; must use authenticated player identity |
| `/public/report` | Sports own account; Manager authorized player reports | Partial native balances/history/stats; full report filters pending |
| `/public/goals-assists` | Sports Statistics; Manager Reports | Native program stats list implemented; full season/search/sort parity pending |
| `/public/leaderboards`, `/reports/leaderboards` | Both Statistics/Reports | Full rankings and awards pending |
| `/reports/stats`, `/reports/attendance`, `/reports/payments`, `/reports/playground-stats` | Manager Reports; only public/own subsets in Sports | Native reports, charts and filters pending |
| `/public/field-status` | Sports session information; Manager Program | Native field-status view pending |
| `/leagues`, `/leagues/new`, `/leagues/[id]` | Manager league operations; public results in Sports only if authorized | Native league setup/teams/fixtures/results pending |
| `/import-whatsapp` | Manager Program | Shared authenticated parse/review/matching/confirmation implemented; development API deployment required; inline record creation and detailed field editing pending |
| `/users` | Manager organization-admin tools | Program membership role/status edit implemented; organization users, linking, password administration pending |
| `/programs`, `/programs/new`, `/settings` | Manager authorized organization tools | Native settings, modules, invitations, report visibility, defaults pending |
| `/platform/organizations` and onboarding/detail | Manager platform-only area | Native platform access and screens pending |
| `/platform/program-templates` | Manager platform-only area | Native template administration pending |
| Report/fixture/team image sharing and CSV exports | Both where website visibility/sharing rules permit | Native rendering/export/share adapters pending |
| Organization production-to-development refresh | Manager restricted development-only operations | Pending secured server job API; never embed production credentials |
| Destructive cleanup/maintenance | Explicitly privileged administrative workflow | Pending separate safety design and confirmation; not ordinary manager access |

## Implementation Order

1. Shared read-only session reporting: podium, standings and player contributions.
2. Session operations: attendance, lineup, team draft, fixture, ratings and completion.
3. Finance parity: drop-ins, waivers, transfers/reversals, notifications and reminders.
4. Reports: global filters, awards, field reports, leagues, image/CSV sharing.
5. Organization/program configuration, invitations, account linking and platform tools.
6. Server-only integrations: WhatsApp parsing/import and development refresh.

Each step needs native UI, authorized API coverage, negative permission tests,
regression tests, and physical-device acceptance before it is marked complete.

## Why Some Work Requires Server Changes

Website Next.js server actions cannot be called as ordinary mobile library
functions. Many actions combine several writes, billing reconciliation or audit
events. Exposing table writes without moving these operations into a guarded,
atomic RPC/API would change behavior and create partial-write risks.

Reusing existing authenticated RPCs is preferred. Missing boundaries require
reviewed API/migration additions. Migration 094 is applied to development only;
no production operation has been executed for this parity pass. LLM/service-role/database credentials
must remain on servers; no EXPO_PUBLIC secret values are acceptable.

## First Delivery

Both apps now have Session > Summary using saved match data from the existing
`mobile_session` RPC. It includes podium, standings, and contributor goals/assists.
Own goals count toward the opponent's score, not the scorer's goal total.
Contributors are keyed by player UUID, so same-name players remain separate.
Assists-only players display zero goals; non-contributors are omitted.

The website's existing standings algorithm was extracted unchanged into
`packages/contracts/src/standings.ts` and is shared by web/native code. Ranking
remains points, goal difference, goals for, away goals, then team name.
Only saved data is reported; an editor's unsaved changes are not presented as
published results. An unfinished session does not label its leader as winner.

This delivery is not full website feature parity. All remaining work is explicitly
marked above. Voice input is not counted as existing website functionality: it
was previously removed and needs its own native implementation plan.

## Second Delivery: Session Operations

Migration `094_mobile_session_operations.sql` adds authenticated roster and
attendance/completion functions. It was applied to the verified development
project with user approval. No production migration was run.

- OU Sports: Account > Session attendance, for authorized captains/managers.
- OU Manager: Program > Attendance and completion.
- Server-side search and 25-player pages include program-linked players and
  existing session attendees, including inactive players with history.
- Statuses match the website: confirmed, played, absent, dropped, replacement,
  waitlisted. Notes are supported. Replacement status alone does not create a
  dropout financial agreement or move money between players.
- Existing attendance billing is reconciled atomically, retaining existing
  waived amounts, linking new usage entries, and removing non-billable charges.
- Managers can complete a session. Confirmed attendance becomes played and
  missing charges are created once. Captains cannot complete sessions.
- Submission IDs protect retries; stale status changes require a reload.
- No direct financial totals are recalculated in JavaScript.

The development smoke test (`scripts/verify-mobile-session-operations.ts`) creates
a temporary session, saves attendance twice, completes it, verifies a single
12.01 charge and ledger, then rolls back all test writes. The deployed test passed.
Migration history is recorded and PostgREST schema reload is requested.
Physical-device acceptance remains pending.

Validation for the second delivery: 249 tests across 40 files passed; web and
all native TypeScript checks passed; both apps exported for iOS and Android.
The development smoke test passed with all temporary writes rolled back.
