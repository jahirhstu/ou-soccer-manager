# Native Apps

Participant app: **OU Sports**. Management app: **OU Manager**.
See [the native design system](mobile-design-system.md) for theme and screen
layouts, and [profile photo troubleshooting](mobile-profile-photos.md) for the
upload flow, lifecycle fixes, and device checks.
The expanded website-to-native scope is tracked in
[the feature parity inventory](mobile-feature-parity.md), including app ownership,
authority boundaries and remaining server-backed work.

The website stays at the repository root. Two independent Expo / React Native
applications live in the same pnpm workspace:

| Project | Purpose | Bundle identifier |
| --- | --- | --- |
| apps/participant | Player account and match-day access | com.ousoccer.participant |
| apps/management | Organization/program management | com.ousoccer.management |

These are native screens, not WebViews. They do not import Next.js, website
components, production-refresh tooling, or server credentials. Their layouts can
evolve independently of both desktop and responsive website layouts.

## Implemented

- Independent application entry points, dependency graphs, configuration,
  secure session namespaces, and EAS build profiles.
- Shared contracts, native controls, account handling, and manual match scoring.
- Full-email sign-in; participant signup and membership requests; approval
  status; email confirmation/password recovery deep links; local sign-out.
- Active organization/program selection. Memberships are rechecked when the
  app resumes. Database functions enforce access again on every request.
- Participant: upcoming sessions, played sessions, saved teams/fixtures/results,
  personal balances/transactions/statistics, program scoring statistics, and
  private profile photos from camera or gallery.
- Both apps: saved session podium, standings, and contributor goals/assists,
  sharing the website standings calculation and retaining player UUID identity.
- Session operations: authorized captain/manager attendance status and notes,
  searchable program roster, atomic session usage reconciliation, and manager-only
  completion. Migration 094 is deployed to development, not production.
- Management: paginated seasons, sessions, players, memberships, player balances,
  ledger history, expenses, and scoring statistics; season/session/player
  creation; program membership status/role changes.
- Financial recording: season payments, completed refunds, player credit
  transfers, season credit carry-forward, and season-assigned expenses.
  Amounts remain decimal strings. Financial writes and audit entries commit
  atomically; retrying unchanged submissions cannot duplicate them.
- Captains/managers can enter goals, assists, own goals, and scoreless played
  results against existing fixtures. Completed sessions remain locked.
- Removed website voice scoring UI, microphone capture, and voice server actions.
  Website manual scoring/autosave remains.

## Remaining Native Work

This is a working first implementation, not complete website feature parity.
The following still need native screens and acceptance testing:

- Organization/program creation and settings; player-account linking and
  invitation administration.
- Team drafting, fixture generation/editing, lineup editing, ratings, and full
  dropout/replacement financial workflows beyond attendance status changes.
- WhatsApp import preview/confirmation, notifications, leagues, and report
  exports/sharing.
- Waivers, club surplus/deficit transfers and reversals, and session-linked
  drop-in payment forms. Current native payment recording is season-level.
- Sport-specific terminology beyond existing goal-based scoring.

Voice is intentionally deferred in both native apps. A later implementation
should use native recording, authenticated transcription, validated structured
commands, and a review/confirm step before changing scores. Signup-opening
schedules and session self-registration are also deferred.

Global platform administration, destructive maintenance, and production-to-
development refresh remain website/operator workflows. Anonymous public
reports remain available on the website, not in the native apps.

## Development Setup

Both apps target Expo SDK 58 (React Native 0.88, React 19.3).
Use Node.js 22.13+ on the 22 LTS line, 24.3+ on the 24 line, or 26+, and pnpm 11.9.0.

1. Install from the repository root: `pnpm install`.
2. Review/apply `supabase/migrations/093_native_apps.sql` to the development
   database through the normal migration process. It assumes migrations through
   091 are present. It does not delete business data. Do not run the historical
   `scripts/generated/dev-upgrade.sql` against an already upgraded database.
3. Each app has its own ignored `.env`, using only the development Supabase URL
   and publishable key. See its `.env.example`. Never put database passwords,
   service-role keys, LLM credentials, or production-refresh secrets in
   `EXPO_PUBLIC_*` variables.
4. Add these exact allowed redirect URLs in development Supabase Auth:
   - `ou-participant://auth/confirm`
   - `ou-participant://auth/recovery`
   - `ou-management://auth/confirm`
   - `ou-management://auth/recovery`
5. Start either app in Expo Go mode (requires Expo Go for SDK 58):
   - `pnpm mobile:participant`
   - `pnpm mobile:management`
   Scan the newly printed QR code instead of opening an old recent-project entry.
   To clear Metro's cache, add `--clear` to the app's start command:
   `pnpm --filter @ou/participant start --clear`.
   For custom development builds, use
   `pnpm --filter @ou/participant start:dev-client` or the management equivalent.
6. For native development builds, run `pnpm --filter @ou/participant ios`
   or `android`, substituting `@ou/management` for the management app.
   iOS requires full Xcode on macOS; Android requires the Android SDK.

Open confirmation/recovery email links on the same device that requested them.
PKCE verification state stays in that application's secure store.
Custom schemes must be tested in a development build; Expo Go is not a substitute
for testing application-specific deep links.
Previously installed SDK 56 development builds must be rebuilt for SDK 58.

The old unused `mobile/` folder was removed. Its ignored local configuration
was preserved as `.env.mobile-legacy.local`; no Git history was rewritten.

## Validation

- `pnpm mobile:typecheck`: both applications and shared packages.
- `pnpm mobile:export`: independent Android and iOS JavaScript/Hermes bundles.
- `pnpm test`: website tests, full SQL migration tests, and native contracts/
  permissions/finance/photo-policy tests.
- `pnpm build`: website regression build.
- CI: `.github/workflows/mobile.yml`.

Database tests run locally in PGlite, with synthetic accounts and a Storage
schema stub. They do not send emails or contact a remote database. Storage tests
exercise ownership policies, not the live Supabase upload service.

Device acceptance still requires testing camera/gallery permissions, secure
session persistence, email links, revoked memberships, font scaling, and screen
reader/keyboard behavior on iOS and Android. Signed EAS builds and store uploads
require project ownership, signing credentials, and final application branding.

The validated Hermes bundles were approximately 4.6 MB for participant and
4.7 MB for management on each platform. This is not APK/IPA size, download size,
or a performance benchmark.
Measure signed release builds before making size or speed claims.
