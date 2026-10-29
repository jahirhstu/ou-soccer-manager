# Native Session Planning And WhatsApp Imports

## Navigation And Authority

- OU Sports: Sessions > select a session. OU Manager: Program > Sessions > select
  a session. Both use the same native session component.
- Build teams: scheduled sessions, program captains/managers, Teams enabled.
- Generate fixture: scheduled sessions without recorded results, program
  captains/managers, Fixtures enabled. The database repeats these checks.
- Edit team lineup: players assigned to that saved team, Teams enabled. Being an
  administrator does not expose another team's lineup editor in the native UI.
- Player performance: program captains/managers, Teams enabled; edits existing
  attacking, defending and goalkeeping skill percentages and notes for players
  in the session's saved teams. These are program ratings, not new match points.
- Attendance is now accessible inside the session as well as the existing menu.
- Mark Session as Complete appears under Session actions and near the top
  of Attendance for managers of scheduled sessions with Activities and Attendance
  enabled. It is hidden while editing scores. Confirmation explains billing and
  scoring lock effects. The existing migration 094 operation reconciles charges,
  preserves waivers, and protects retries with a stable submission ID. Successful
  completion reloads the screen. Captains and players cannot complete sessions.
- OU Manager: Program > WhatsApp import. Program manager access and the WhatsApp
  import module are checked on the server. OU Sports has no import action.

## Implemented Workflows

Team building supports team names, captains, player assignment/removal, capacity,
lottery captain order, balanced suggested pick order, explicit draft saving and
resumption, and reviewed publication through existing program-authorized RPCs.
Waitlisted players are excluded from the draft pool. Existing saved players are
retained. The mobile redesign adds an animated captain draw, a horizontal team
board and searchable draft pool. Saved remote changes produce a reload prompt;
browser drag-and-drop, unsaved broadcast collaboration, realtime presence, and
automatic draft saving are not reproduced.

Fixture generation supports repeated pairings, alternating home/away, preferred
first resting team, two game durations and one break. Migration 095 makes the
operation atomic and audited with submission-ID retry protection. It will not
replace recorded results. A Settings/Preview flow displays estimated matchups
before the server saves exact timings. Native fixture row editing is not included.

Lineups support saved formations, player assignment/removal and position
coordinates. Saved custom coordinates are retained until the formation changes.
The native pitch now supports tap-to-assign and jersey-colour swatches. Empty
formation slots are restored when reopening partial lineups. Pitch drag-and-drop
is not included. See [planning UX](mobile-planning-ux.md) for the comparison and QA.

No goal, assist, own-goal, goalkeeper-at-goal or performance-points rules changed.

## Import Matching

`packages/contracts/src/import-identity.ts` is shared by website and mobile.
If Ronnie and Ronnie Khan both exist, importing Ronnie requires explicit identity
selection. Duplicate full names and conflicting aliases also require review.
Unrelated prefixes such as Ronniel are not candidates for Ronnie. The website
shows amber, leaves the selector empty and blocks submission until selected or
ignored. Server validation runs before import writes, not just in the UI.

The mobile workflow parses a message, selects an existing season/session,
reviews records, selects/ignores player identities and confirms. It uses the same
import service as the website. Creating new players/seasons/sessions within the
mobile review and editing individual parsed financial fields are not included;
create records first or edit the message and parse again. The review fails closed
at 1,000 option rows instead of silently accepting truncated matching data.

## Deployment

- Migration `095_mobile_session_planning.sql` was applied to development project
  `vnmloamscqaqmagimfmz`. Production was not accessed or changed.
- OU Manager's local `EXPO_PUBLIC_WEB_API_URL` points to
  `https://ou-soccer-manager-git-develop-jahirhstu.vercel.app`.
- Deploy the development website code before testing mobile WhatsApp imports.
  The new endpoint is `POST /api/mobile/whatsapp`; it authenticates the Supabase
  bearer token and derives organization/role from verified database records.
  No service-role key or LLM credential is bundled in either app.
- The supplied development URL currently returns a Vercel Authentication
  "Protected deployment" response to unauthenticated native API probes.
  Mobile import is therefore deployment-blocked. Do not embed a Vercel
  protection-bypass secret in the app; configure an appropriately protected API
  deployment if necessary. The endpoint must use the same development Supabase
  project as the apps.
- Existing historical generated development-reset SQL is not an instruction to
  rerun it on the current development database. Only migration 095 was applied.

## Validation

Targeted tests cover ambiguous identities, aliases, explicit selection, no writes
on rejected imports, API authentication/program-role/module checks, fixture
retry isolation, alternating home/away, break timing, played-result protection,
and balanced draft order. Both native apps export for iOS and Android and pass
TypeScript checks. The generated maintenance upgrade was refreshed for 095 and
its schema-upgrade test passed after regeneration.

Physical-device interaction, camera/gallery, the deployed mobile import endpoint,
and concurrent multi-user editing still require acceptance testing. No claim of
physical-device validation or complete website feature parity is made.
