# OU Native Redesign: Audit And Delivery

## Architecture Audit

- Branch: `develop`. Existing uncommitted work is preserved. No backend or schema
  changes are part of this redesign.
- Apps: `apps/participant` (OU Sports), `apps/management` (OU Manager).
- Runtime: Expo SDK 58, React Native 0.88, React 19.3, TypeScript.
- Navigation: existing local React state; no React Navigation or Expo Router.
  Bottom tabs now wrap existing screen state, rather than replacing the stack.
- UI: shared React Native StyleSheet components in `packages/mobile-ui`, Lucide
  icons, native system fonts, safe-area provider in each app.
- Auth: Supabase PKCE, SecureStore, account recovery links, membership-gated app
  access. Photo storage remains private and scoped to the signed-in profile.
- Scope: `mobile_context` supplies approved organizations/programs and roles.
  OU Manager requires an existing manager workspace. Platform-owner identity
  alone does not grant native program access; no new privilege is introduced.
- Modules and scoring authorization remain enforced by existing RPCs. Captains
  enter results only where existing program/session rules permit.

The supplied public website URL could not be fetched by the browsing tool during
this audit. Local website source supplies established branding: `pitch #0f7a4a`,
`ink #18212f`, `line #dce5df`, and the OU lettermark in `PublicShell.tsx`. The
mockup guides visual hierarchy, not feature scope. No illustrative totals, player
photos or registration capacities from the reference were copied into the apps.

## Current Screen Inventory And Redesign Map

| Existing feature/screen | Existing source/API | Redesigned location |
| --- | --- | --- |
| Sign in, signup, password reset/recovery | `gate.tsx`, Supabase Auth | Branded auth forms; account and membership field groups |
| Membership request/status | `request_membership_for_slug`, `mobile_context` | Membership screen with separate status badges |
| Approved workspace switch | `WorkspaceMenu`, `mobile_context` | Sports Account; Manager More |
| Sports home | Participant App | Home with live next-session, personal-statistics and last-played previews |
| Upcoming/all/played sessions | `mobile_list` | Sessions tabs |
| Personal/program statistics | `mobile_list` | Statistics tabs, existing goals/assists/appearances detail retained |
| Personal balances/transactions | `mobile_list` | Read-only Finances tabs; exact amounts retained, credit/debt/settled labels |
| Profile/gallery/camera | Participant Profile, private Storage, `set_my_photo` | Account identity, photo actions and membership information |
| Saved teams/fixtures/results | `mobile_session` | Session screen with teams/games views |
| Captain/manager scores | `mobile_save_scores` | Contextual result action; result review before save |
| Manager dashboard | Management App | Dashboard with next-session preview and scoped quick actions |
| Seasons/sessions/players | `mobile_list`, `mobile_create_record` | Program lists and create/review screens |
| Members and role/status editing | `mobile_list`, `mobile_member`, `mobile_update_member` | Members list, editor and review screen |
| Balances/transactions/expenses | `mobile_list` | Finance records |
| Payment/refund/transfer/carry/expense entry | `mobile_credit_preview`, `mobile_record_finance` | Finance actions, details and separate confirmation screen |
| Account/sign-out | Auth and context | Sports Account; Manager More |

## Navigation

OU Sports: Home / Sessions / Statistics / Finances / Account.

OU Manager: Dashboard / Program / Members / Finance / More.

Disabled program modules hide corresponding destinations. Program context is
always shown above data and edit screens. Switching programs remounts the scoped
screen tree, clearing previous-program selections. Detail/edit screens hide the
bottom bar so changing tabs cannot silently discard score edits or a financial
submission. Existing Android Back behavior and score-discard confirmation remain.

## Data Contract Limits

`mobile_list` returns 25-row pages of `{ id, title, subtitle, detail }`, not a
structured dashboard aggregate. This redesign does not change that contract.

- Home previews show a real first row, not fabricated totals or aggregates.
- Season preview is labelled most recent, not assumed active.
- Search/status filtering is explicitly scoped to the current page. It is not
  advertised as server-wide member search. Pagination remains available.
- Session time/capacity/signup status is not added when absent from the API.
- Financial rows retain original currency/decimal strings. No computed club
  balance, aggregate player credit, top-up or payment collection is introduced.
- Finance views retain season names on rows. A global season filter and richer
  transaction details require a structured API extension in a separate task.
- Program leaders retain the API's goal-first ordering. A separate assist-sorted
  global leaderboard is not faked by sorting one loaded page.
- No new member-registration wizard: creating a player record and editing an
  existing membership remain different supported operations.
- Season and player lists retain their available details; no unsupported detail
  APIs are invented.

## Sensitive Actions

Financial confirmation shows amount, transaction type, source season/player,
destination player/season where applicable, date, method/category and note.
Refund confirmation explicitly describes an already-completed external refund.
Existing credit checks, exact decimal handling, idempotency IDs and RPCs remain.

Membership review separates organization membership from program role and
program status. No platform role assignment is exposed. Create screens also
show a review summary using only existing fields.

## Changed Files

- `packages/mobile-ui/src/ui.tsx`: tabs, segments, badges, summaries and tokens.
- `packages/mobile-core/src/overview.tsx`: scoped context and live preview reads.
- `packages/mobile-core/src/records.tsx`: cards, current-page search/status filter.
- `packages/mobile-core/src/gate.tsx`: authentication and membership presentation.
- `packages/mobile-core/src/index.ts`: shared exports.
- `packages/contracts/src/index.ts`: presentation/module-mapping helpers only.
- `apps/participant/App.tsx`: Sports tabs, dashboard, finance/statistics grouping,
  profile and sign-out.
- `apps/management/App.tsx`: Manager tabs, dashboard and grouped program/finance.
- `apps/management/src/Finance.tsx`: full financial review.
- `apps/management/src/Member.tsx`: role/status separation and review.
- `apps/management/src/CreateRecord.tsx`: record-creation review.
- `packages/match-day/src/session.tsx`: contextual scoring and result review.
- `lib/tests/mobile-presentation.test.ts`: data labels, filtering and module mapping.

## Scope Of This Visual Pass

This UI-only pass adds no new business workflows. Subsequent feature work has
already added team building, fixture generation, attendance, lineup editing,
performance ratings, session completion and Manager WhatsApp import. Those
existing features are preserved; see `mobile-session-planning.md` for limitations.
Voice scoring, new accounting rules, payment top-ups and unsupported signup
actions are not introduced by this redesign.

## Compact Layout Update

The shared system now differentiates session, member, statistics and financial
records rather than presenting every resource as an identical text row. Program
context, existing tabs and authorization remain unchanged. Session tools are
grouped, podium and standings are compact, and result details expand on demand.
Selectors with many options use a searchable modal. Related form fields use
columns, falling back to a vertical layout for large accessibility text.

Visual checks use temporary browser previews of the actual React Native shared
components, session screen and finance action screen with local sample data.
These fixtures are outside the repository and are not shipped in either app.
Browser screenshots are not a substitute for native device testing.

## Device Verification

Physical iOS/Android tests remain required. This workstation has no iOS simulator;
native screenshots are not claimed. Camera/gallery tests are still pending on a
physical device. Automated photo workflow and ownership-policy tests remain.

Check narrow phones and large text: bottom-tab labels, long names, keyboard
avoidance, navigation, program changes, empty/error/loading states, role-gated
scoring, review/edit/save flows, duplicate retries, and gallery/camera cancellation.

## Earlier Redesign Verification

- Full regression suite: 238 tests across 39 files passed.
- Native TypeScript: all six workspaces passed after the final error-handling edits.
- OU Sports and OU Manager: iOS and Android exports completed successfully.
- `git diff --check`: passed.
- No schema migration or remote financial operation was executed for this redesign.
- No native screenshots were captured; physical-device UX acceptance is pending.

## Latest Compact Layout Verification

- All six mobile workspace TypeScript checks passed.
- Sixteen focused tests passed: presentation (4), session summary (5), session
  completion (2), and photo workflow (5).
- Both apps exported successfully for iOS and Android.
- Twelve browser previews passed without page errors or horizontal overflow:
  Sports dashboard, Manager dashboard, session summary and finance actions at
  320, 390 and 430 pixels. The narrow podium and Manager/finance previews were
  also visually inspected. These are component previews, not authenticated
  end-to-end device tests.
- `git diff --check` passed. No schema or financial changes were made for this pass.
- Physical-device checks remain pending: camera/gallery, large system fonts,
  keyboard avoidance, native modal selection, and real account navigation.
