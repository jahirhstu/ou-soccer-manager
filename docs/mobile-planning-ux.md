# Mobile Session Planning UX

## Website Comparison

| Workflow | Existing website | Previous native screen | Updated native treatment |
| --- | --- | --- | --- |
| Team building | Roulette, coloured team columns, visible draft pool, captain controls | One selected team, long form, separate player picker | Animated captain draw, horizontal team board, bordered player rows, visible searchable pool, tap-to-assign |
| Lineup | Pitch, formation, shirts, player pool and spatial placement | Position cards and coordinate inputs | Portrait pitch with tappable shirts, formation selector, bench and complete position list; precision coordinates in position editor |
| Fixture | Setup controls and game-by-game schedule | Numeric fields and total games only | Settings/Preview stages, summary metrics, home/away matchup rows and break separators |

Sources inspected: `components/TeamBuilder.tsx`, `components/LineupBuilder.tsx`,
`components/SessionFixtureGenerator.tsx`, and their native equivalents in
`packages/match-day/src`.

## Research And Decisions

- [TeamStats](https://www.teamstats.net/all-teamstats-features) uses formation
  selection and player placement as the primary lineup concept. This reinforces
  the pitch-first model already present in OU's website.
- [Premier League lineup presentation](https://www.premierleague.com/en/news/4081650)
  presents formations alongside the players. The native pitch therefore retains
  the selected formation and assignment count in its summary.
- A phone cannot comfortably fit three seven-player desktop columns. Native
  team cards use a horizontal board, preserving player-name legibility and
  reducing vertical displacement of the draft pool.
- Tap-to-assign replaces precise dragging. Pitch markers have full accessible
  names; abbreviated labels on the field have a full-name position list below.
- The captain draw respects reduced-motion preferences. Editing and persistence
  are disabled while drawing; the completed draw determines the displayed order.
- Match settings and preview are separate stages, not one long form.

These are product-design adaptations, not findings from user usability studies.

## Behaviour And Safety

- Existing session/program authorization, RPCs, lineup RLS, score locks and
  financial logic are unchanged. No migration is needed.
- Team assignment updates the local board and pool immediately. A subscription
  to the existing `session_team_update_events` reports saved remote changes.
  Reloading requires confirmation when local edits exist. This is **not** parity
  with the website's unsaved broadcast collaboration, presence or autosave.
- Draft and final team saves remain explicit. No other editor's changes are
  silently loaded over an unsaved local draft.
- Fixture preview mirrors current round-robin pairing, repeat alternation and
  rest-first inputs. It is labelled estimated: database collation and concurrent
  team edits can affect final order. The server remains authoritative, generates
  exact timings from session start time, and rejects replacement of played games.
- Saved lineups may contain only assigned positions. Empty formation slots are
  now restored while retaining saved custom positions, identities and colours.
- Lineup access remains limited to teams authorized by the existing membership
  flow. A manager/captain label alone does not grant editing of every team.

## Navigation

In Session details, open **Session actions**, then **Build teams**, **Generate
fixture**, or **Team lineup**. Visibility follows the existing modules, role,
team membership and session status. Fixture generation is unavailable once
results have been recorded.

## Changed Files

- `packages/match-day/src/team-builder.tsx`
- `packages/match-day/src/captain-draw.tsx`
- `packages/match-day/src/lineup.tsx`
- `packages/match-day/src/pitch.tsx`
- `packages/match-day/src/fixture.tsx`
- `packages/match-day/src/planning-layout.ts`
- `lib/tests/mobile-planning-layout.test.ts`

## Verification

Six presentation tests cover formation size, coordinates, partial/custom saved
lineups, fixture pairing, rest preference, repeated home/away alternation and
invalid/excessive previews. Existing presentation and summary regressions are
also run.

Results: 17 tests passed across planning layout, presentation, draft order and
session summary. All six native workspace TypeScript checks passed. Both apps
exported for iOS and Android. Nine browser layout/interaction checks passed
across the three planning screens and three phone widths. Final captain-removal
and preview-button refinements were checked with TypeScript and browser tests.

Browser checks use real React Native components rendered via React Native Web,
with temporary local test data, at 320/390/430-pixel widths. They exercise captain
draw, draft-pool assignment, pitch assignment and fixture preview. This is not a
physical-device or live-database collaboration test.

Physical iOS/Android acceptance still needs: reduced-motion draw, large system
text, pitch hit targets, horizontal board scrolling, keyboard behaviour, real
save/reload, and simultaneous-device saved-update notification. Device testing
must not be inferred from successful bundle exports.
