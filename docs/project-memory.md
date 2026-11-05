# Project Context and Working Memory

Reviewed: 2026-11-04. Scope: changes from the preceding week, including migrations, documentation, web, native apps, shared packages, tests, and operational scripts.

## Repository Snapshot

- Reviewed HEAD: `f6453f5` (`implemented nomiation UI and team builder UI`).
- Active branch was `main`. Local `main` and `develop`, and their locally cached remote references, pointed to the same commit. No remote fetch was performed.
- Working tree was clean before this note was added. This is a context review, not an implementation or deployment.
- Branch and deployment state are snapshots: verify them before subsequent work. Do not infer permission to modify production from historical conversations.

## Architecture

- Next.js website and Supabase backend support organization- and program-scoped access and data.
- The pnpm monorepo contains OU Sports in `apps/participant` and OU Manager in `apps/management`.
- Shared packages include `contracts`, `mobile-core`, `mobile-ui`, and `match-day`. Preserve existing authorization and financial contracts when changing presentation.
- OU Sports serves players and contextually authorized captains. OU Manager serves authorized administrators. Program/session permissions, not just app choice, determine access.
- Native functionality includes account/membership flows, program switching, session operations, scoring, planning tools, and finance workflows appropriate to each app. Full website/native parity is not complete.
- Recent nomination and Guided drafting UI changes are predominantly website changes. Do not assume the native screens implement these latest workflows merely because shared SQL exposes compatible APIs.

## Main Changes This Week

1. Native app and operational tooling work, followed by the documented program-scoped production schema upgrade and identity-safe backfill.
2. Empty program-context UUID fix for team builder operations (`096`).
3. Initial match positions, goalkeeper attribution, performance calculations, and voting (`097`-`100`).
4. Player nominations, scoped public performance results, and legacy-schema reconciliation (`101`-`103`).
5. Event-based website ratings replacing the manual match-position workflow (`104`).
6. Played-fixture nomination availability, Guided drafting, and position-independent nomination eligibility (`105`-`107`).
7. Session-summary Top Players/public performance integration, summary presentation changes, and compact nomination/team-builder UI refinements.

## Current Performance Rules

Authoritative sources: `supabase/migrations/104_event_based_position_ratings.sql`, subsequent migrations, and `lib/performance-position.ts`.

- Goal entry retains scorer and assist and captures scorer position and the opposing goalkeeper who conceded. Any opposing roster player can be selected as goalkeeper.
- Position resolution uses all distinct event positions first. With no event position, it falls back to session lineup, then profile preferred position. These sources are not mixed. Legacy manual match positions are not the website ratings source.
- Participation is derived from saved session rosters and played fixtures. Never hardcode matches per session.
- Match rating is capped at 10. Session match points are `sum(match ratings) / (10 * actual matches played) * 40`, with zero/missing-data handling in the implementation.
- Position bases: goalkeeper `8 / (1 + 0.5 * individual goals conceded) + result bonus`; defender `6 / (1 + 0.5 * team goals against) + result bonus`; midfielder `0.75 * min(team goals for, 4) + 2 * clean sheet + result bonus`; forward `0.75 * min(team goals for, 4) + result bonus`.
- Result bonus is 2 for a win, 1 for a draw, and 0 for a loss. Individual contribution is `2 * goals + assists`, capped by position (GK/defender 2, midfielder 3, forward 5). Multi-position bases are equally weighted and individual contribution is added once using the highest applicable cap.
- Goalkeeper attribution supports rotation; incomplete attribution remains provisional. Event-only goalkeeper participation does not prove a full-match clean sheet.
- Nomination points are capped at 60 per player; combined session rating is capped at 100. The category pool is 60 and each valid vote contributes `min(20, 60 / valid category vote count)`.
- This is NOT the original captain-only 30-points-per-vote design. Existing skill-percentage ratings used for drafting remain a separate concept.

## Current Nomination Rules

Read `105_played_fixture_nominations.sql` and `107_position_independent_session_nominations.sql` together; the latter supersedes earlier position-based eligibility.

- Voting is player-based, not restricted to three captains. Voters need authorized program membership and a linked player, plus session roster participation or explicit manager authorization.
- Nominations open after at least one fixture is marked played. Completed sessions are read-only; explicit voting closure also prevents submissions.
- No self-nomination. Any other saved session roster player may be nominated for goalkeeper, defender, or midfielder, regardless of resolved position. Own-team nominations are allowed.
- The same nominee can be selected in multiple categories. Each voter-player/category has one immutable submission; duplicate submissions are rejected.
- Managers have scoped voter-authorization and voting-control actions. These do not override the completed-session restriction.
- The website uses a compact player/category selection matrix and award/vote summaries. Tied winners are supported.
- Relevant files: `components/SessionNominations.tsx`, `app/sessions/[id]/nomination/page.tsx`, player/captain route helpers, and middleware.

## Team Builder and Native Boundaries

- Website draft modes are Lottery, Balanced, and Guided. Guided drafting groups the pool by position and provides session-scoped category overrides.
- Category overrides do not change a player's profile, session lineup, match positions, or performance ratings.
- `106_guided_team_builder_draft.sql` provides the dedicated Guided save RPC, validating authorization, program scope, player IDs, and categories.
- Main web implementation: `components/TeamBuilder.tsx` and `lib/team-builder-draft.ts`.
- Native planning has captain draw, team-board, lineup, and fixture workflows, but do not assume website autosave/presence or latest Guided UI parity.
- WhatsApp import identity matching must require confirmation for ambiguous names rather than treating an exact short-name match as conclusive. Native parsing uses the authenticated website API and must target the same environment as the apps.

## Migrations and Operational Safety

- Latest checked-in migration number at review: `107`. The duplicate `096` numbering issue from the earlier conversation is no longer the current inventory: `096_empty_program_context_uuid.sql` is the UUID fix.
- `093` supplies native APIs/photo permissions; `094` adds session operations; `095` adds planning/fixture functionality. Preserve these when preparing clean databases.
- `103` reconciles legacy performance schemas and archives ambiguous position records rather than blindly replaying `097`-`102`. It intentionally blocks when legacy audit history needs manual review.
- Development refresh/cleanup/seed tools must track new tables and dependencies. Production-to-development refresh remains strictly one-way and guarded; never reverse its direction.
- `docs/production-release.md` records an October 29 production upgrade through `095`, preserving existing auth accounts, financial balances, and ambiguous-account links safely. This is historical evidence, not proof of today's live schema.
- `docs/development-database-upgrade.md` records development verification through `101` on October 31. It likewise does not establish today's migration level.
- Use schema/history comparison before choosing migrations. Do not rerun old baseline-specific production or reset scripts against an already upgraded database.
- No live database inspection, migrations, application tests, or physical-device tests were performed for this context review.

## Documentation and Verification Cautions

- `docs/position-performance.md` explains the event-based calculation but its position-based nomination eligibility text is superseded by `107`.
- `docs/mobile-feature-parity.md`, `docs/mobile-session-planning.md`, and `docs/mobile-planning-ux.md` describe native coverage and gaps; reconcile them with newer code before making parity claims.
- Automated photo-upload tests do not prove physical camera/gallery operation. Device verification remains a separate requirement.
- Useful targeted test sources include `lib/tests/migration-103-reconciliation.test.ts` and `supabase/tests/public_session_performance.sql`, alongside the existing performance, nomination, planning, and authorization tests.
- Before resuming implementation: verify branch/worktree, inspect the specific feature's latest code and migration history, and use these current rules instead of reviving the original captain-only/manual-position plan.
