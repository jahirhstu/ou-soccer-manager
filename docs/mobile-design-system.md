# Native App Design System

For the subsequent tab-navigation redesign, screen mapping, API limitations and
delivery inventory, see [mobile redesign audit](mobile-redesign-audit.md).

## Scope

OU Sports (participants and captains) and OU Manager share native React Native
components, not the website's mobile HTML layout. All work is on `develop`.
The display name is OU Sports; bundle IDs, URL schemes, and stored sessions are
unchanged so existing authentication links continue to work.

## Theme

| Token | Decision |
| --- | --- |
| Background | Subtle green-neutral `#F3F6F5` |
| Surface | White |
| Primary action | Forest `#064631`; emphasis green `#087D52` |
| Context / selected navigation | Forest green `#064631` |
| Secondary accent | Blue `#2166a0` for navigation icons |
| Main text | `#172A25` |
| Supporting text | `#64736E` |
| Dividers | `#DFE7E3` |
| Error | `#b42335`, accompanied by text |
| Type | Native system font: iOS and Android defaults, no font download |
| Page heading | 23/29, bold |
| Record title | 15/20, semibold |
| Detail | 14/20, regular |
| Metadata | 12/17, regular |
| Section heading | 12/18, bold |

Spacing uses 4/8/12/16/24 points. Content is constrained to 720 points on tablets;
phones use the available width with 16-point side margins. Repeated shortcut
items have at most 8-point corners. Sections are not nested cards.

## Navigation And Density

- Fixed page title and 44-point back control remain visible during scrolling.
- Android hardware Back follows the same route; unsaved scores still require
  confirmation before leaving.
- Home shortcuts use two flexible columns. Icons and titles identify destinations;
  long labels wrap rather than shrinking the font or truncating information.
- Lists use compact divider rows and distinguish bold titles from muted metadata.
- Selection controls with more than five options use a searchable modal rather
  than filling the screen with chips. Smaller option sets wrap.
- Inputs retain 46-point minimum heights; buttons retain 48-point touch targets.
- Forms use keyboard-aware scrolling. Data remains scrollable when content or
  accessibility text size grows: density must not hide information.
- Financial data is not reformatted through floating-point arithmetic.

## Screen Inventory

| Screen | Layout treatment |
| --- | --- |
| Sign in, registration, recovery | Fixed title, vertically labelled fields, primary submission action, secondary account actions |
| Membership pending/error | Same header, readable status and error detail, explicit retry/sign-out actions |
| OU Sports home | Workspace selector, personal identity, compact sports/finance shortcut grid, profile entry |
| OU Manager home | Workspace selector, transaction entry, management shortcut grid |
| Sessions and played/upcoming sessions | Virtualized divider list, fixed heading, 25-row pagination |
| Balance, payments, expenses and statistics | Same compact list hierarchy, full financial/detail text retained |
| Seasons, players and members | Same list structure; create action remains above records |
| Profile | 80-point avatar or person placeholder beside identity; photo actions with icons and busy feedback |
| Match day | Games/teams selector; equal flexible team-name columns around a distinct score; editable goal controls retained |
| Saved teams | Titled roster sections with divider rows |
| Scorer/assist picker | Scrollable selectable player rows and explicit close action |
| Membership editor | Compact wrapping role/status selections, approval switch and save action |
| Create player/season/session | Consistent labelled fields and related-record selection |
| Finance | Season/player selections, credit preview, wrapping method/category controls, review before confirmation |

## Implementation

### Compact Visual Refinement

- Session records use a date tile, prominent title, status badge and venue row.
- Player statistics separate goals, assists and appearances into numeric columns.
- Financial records emphasize the unchanged currency string, with credit/debt
  labels; amounts are never recalculated by presentation components.
- Shared avatars, horizontal metrics, icon shortcuts and paired form fields
  establish hierarchy without adding more screens.
- Session tools are grouped under Session actions. Games retain their results
  at a glance; Match details expands the original goal and assist records.
- Session summary uses a three-column podium and compact standings with
  expandable details. Large accessibility text uses stacked detail rows.
- Numeric form fields and photo actions use two columns when text size permits.
- The program/organization context remains visible; authorization and backend
  contracts are unchanged.

Additional implementation files: `packages/mobile-core/src/record-item.tsx`,
`packages/mobile-core/src/overview.tsx`, `packages/match-day/src/ratings.tsx`,
`packages/match-day/src/fixture.tsx`, and `apps/management/src/Finance.tsx`.

- `packages/mobile-ui/src/ui.tsx`: colors, typography, headers, sections,
  shortcuts, choices, buttons, fields and record rows.
- `packages/mobile-core/src/records.tsx`: fixed list headers and dense list spacing.
- `apps/participant/App.tsx`, `apps/management/App.tsx`: role-specific home layouts.
- `packages/match-day/src/session.tsx`: match/roster presentation.

## Phone Acceptance Checklist

Test on iOS and Android at narrow phone widths and with large accessibility text:

1. Sign in; switch programs; navigate to every enabled shortcut and back.
2. Check long player, team and organization names wrap without overlapping icons.
3. Scroll lists and verify the heading remains visible and pagination works.
4. Open the keyboard in a long form; reach the final field and submit action.
5. Review payments/refunds without losing currency, season or player context.
6. Edit a score, cancel navigation, save, and check teams/results.
7. Upload a gallery image and a camera image, cancel a picker, and deny permission.
8. Background/resume while editing and verify the current screen remains mounted.

Automated bundle/type checks do not replace physical-device layout review.
This workstation has no iOS simulator, so device screenshots and camera/gallery
acceptance remain a manual check rather than a claimed automated pass.

## Validation Results

- All six native workspace TypeScript checks passed.
- OU Sports and OU Manager exported successfully for both iOS and Android.
- Eight focused photo/error/configuration tests passed.
- Sixteen local native SQL tests passed, including private-photo ownership.
- Physical-device visual review and picker interaction are still pending.
