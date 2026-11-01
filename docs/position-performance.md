# Position Performance and Player Nominations

## Availability

The website implements match position confirmation, scoring, performance ratings,
and player nominations. Existing draft skill percentages, goals/assists rankings,
payments, attendance and team formation remain separate and unchanged.
The fixes documented here are website-only; mobile clients are unchanged.

- Website: Session > Ratings and Session > Nomination; score entry links to match positions.
- Public Dashboard: top goalkeeper, defender, and midfielder cards use the existing
  season performance ratings and public-report scope.
- Player page: performance and position history, with session breakdown links.
- OU Sports / OU Manager: Session actions > Match ratings & votes.
- OU Sports: Statistics and Account > performance history.
- OU Manager: Dashboard / Program > Position leaderboards & match ratings.

## Match Workflow

1. Set a player's global default position on the player record.
2. Optionally override that position for the session in the website Lineup Builder.
3. During website score entry, a scorer's position may be explicitly selected.
   The Goalkeeper Conceded picker lists the full opposing roster, sorted by name;
   it suggests the first participating player whose resolved position is goalkeeper.
   If no goalkeeper position is known, select the player manually.
4. On Session Details > Ratings, review or override match positions.
   Players assigned to a participating team count as participating by default.
5. Mark scoreless games played using the existing scoring control.
6. Complete the session. Participating players and admin-authorized nonparticipants
   can submit nominations from the Nomination page.

Unknown positions still count as appearances but contribute zero to the session
numerator and are marked incomplete. Explicitly excluded participants do not enter
the denominator. This avoids inflating ratings by discarding unknown appearances.

Goalkeeper attribution is nullable. Missing attribution is not reported as zero
conceded. Historical match scores remain authoritative even without goal events.
When keeper attribution is incomplete, the rating uses team goals conceded as a
conservative penalty and labels the data incomplete. A clean sheet requires a
confirmed goalkeeper appearance in a played game whose team conceded zero.
Within-match goalkeeper minutes are not tracked: multiple confirmed keepers on a
clean-sheet team each receive that team's clean-sheet bonus.

## Scoring Version 1

Exact weights were not specified in the request; these are the implemented defaults.
They are centralized in `match_performance_points_v1` and should be reviewed before
competitive use. Future policy changes should introduce an explicitly versioned rule.

| Component | Goalkeeper | Defender | Midfielder | Forward |
| --- | ---: | ---: | ---: | ---: |
| Appearance base | 2 | 2 | 2 | 2 |
| Win / draw / loss | 2 / 1 / 0 | 2 / 1 / 0 | 2 / 1 / 0 | 2 / 1 / 0 |
| Team clean sheet | 4 | 3 | 1 | 0 |
| Each team goal (component capped at 2) | 0.10 | 0.15 | 0.25 | 0.50 |
| Each individual goal | 2 | 1 | 1.5 | 2.5 |
| Each assist | 1 | 0.75 | 1.5 | 1.5 |
| Each conceded goal penalty | 0.75 | 0.50 | 0.25 | 0 |
| Maximum conceded penalty | 4 | 3 | 2 | 0 |

Goals plus assists are capped at 4 points. Own goals are not individual attacking
goals. Every match rating is bounded to 0–10, using PostgreSQL numeric arithmetic.

Session match points = sum of match ratings / (10 × actual appearances) × 40.
No match count is hardcoded. For each of Top Goalkeeper, Top Defender, and Top
Midfielder, points per nomination are `min(20, 60 / valid category nominations)`.
Each player's combined nomination points are capped at 60 across categories. The
session final is bounded to 100. Forward-only participants cannot receive nominations
and retain a maximum of 40. Players who switch positions may receive nominations
only for non-forward positions they actually played.

For every match, the resolved position priority is:

1. Performance & Voting match-specific position.
2. Position explicitly selected during website goal scoring.
3. Session Lineup Builder position.
4. Player profile default.

Website score saves store explicit score positions separately; fallback values are
not copied into match-specific performance overrides.

Season Rankings rank mean position-specific session ratings, not raw appearance
totals. Each position/session is normalized to 40 and receives only that category's
nomination points. Match averages, appearances, sessions and nomination counts are
shown separately. Forward rankings have a 40-point maximum.

## Voting and Authorization

- Nominations open only when the session is completed.
- An active program membership must link the signed-in account to a player profile.
  Players assigned to the session can nominate; managers may additionally authorize
  active program players who were not assigned to a session team.
- A nominee must have participated at the nominated position in a played match.
  Players may nominate teammates, but cannot nominate themselves.
- Each voter may submit one nomination per category. Duplicate submissions are
  rejected. A manager can close and reopen nominations.
- Managers may reopen voting. Changes and voting status are audited.
- All tied leaders with at least one valid nomination are returned. Awards remain
  provisional while nominations are open.
- Corrections to participation/positions can invalidate a vote; original vote rows
  remain stored but do not contribute until eligible again. Closed voting freezes
  ballot edits, not the underlying corrected match facts.

All writes validate scope in database functions. New tables have RLS and no direct
authenticated write grants. Website score entry permits manual goalkeeper attribution
only to a participating player on the opposing team; other score-writing paths retain
the confirmed-goalkeeper validation. Results are authenticated, program-scoped reads,
not new anonymous public endpoints. UI permissions do not replace database checks.

## Recalculation and Safety

Ratings are live SQL views, not incremented totals. Goal, assist, result, position,
keeper and vote corrections are reflected on the next read. Match IDs survive score
corrections. Performance overrides and score-selected positions have distinct storage,
so changing a lower-priority source updates ratings unless a higher-priority override
is present.

## Deployment

New migrations, in order:

1. `096_empty_program_context_uuid.sql`: pooled authorization-setting UUID fix.
2. `097_match_performance.sql`: positions, votes, scoped APIs, audit and calculations.
3. `098_performance_goal_entry.sql`: atomic score save preserving match IDs and keeper round-trip.
4. `099_website_performance_position_workflow.sql`: website score positions and
   performance workflow.
5. `100_match_position_priority.sql`: distinct score-position storage and shared
   position resolution.
6. `101_session_player_nominations.sql`: session player nominations, dynamic points,
   and voter authorization.

Migration 100 restores match positions from the Performance & Voting audit. Older
score saves wrote fallback positions into the same table without recording their
source; those unaudited rows are removed rather than promoted to stale overrides.
An intentional old score-entry choice cannot be recovered separately from a copied
fallback because the old database did not record that distinction.

There must be only one migration numbered 096. The duplicate earlier draft was
removed during conflict resolution. If any environment has already recorded a
different 096 filename, inspect migration history before deploying; do not replay
both versions blindly.

These changes have not been applied to production. Back up the target database,
apply migrations before deploying the updated clients, then verify a test session.
Historical position repair is limited to the audit-based recovery described above.
Ambiguous legacy score-entry choices cannot be recovered separately. Financial data
is not modified.

`scripts/generated/dev-upgrade.sql` and `dev-cleanup.sql` were regenerated locally.
The cleanup script remains destructive and development-only. Do not use it to deploy
this feature to production. Organization refresh now recognizes and scopes the new
tables, including sources predating these additive tables.

To reverse a deployment, roll back clients first. Prefer restoring a verified backup
or a forward corrective migration. Dropping performance tables would destroy new
participation, ballots and audit data and is not an automatic rollback strategy.

## Verification

Database tests cover 1/2/4 matches per player; three seven-player teams with six
matches; scoreless games; partial/unknown participation; position changes; keeper
attribution; correction rollback; player nomination eligibility, dynamic points and
closed voting;
season averages; and unauthorized writes/reads. UI tests cover eligibility, tied
awards, point breakdowns, empty results and closed/read-only controls. Regression
tests also cover player-list pagination, unpositioned players, goalkeeper suggestions,
manual opposing-roster selection, score-position source tracking, and the four-level
position priority.

Website checks remain necessary in a deployed environment: open a saved session,
confirm positions, select a keeper, save scores, complete the session, submit a
nomination, close voting, switch programs and verify the season/profile results.
No deployed-environment test is claimed by this implementation.

### Read-only SQL Checks (SQL Editor)

Use explicit UUIDs from your test session:

```sql
select * from public.session_performance_results
where session_id = '<session-uuid>'::uuid order by final_rating desc;

select player_name, match_number, position, goals_for, goals_against,
       keeper_conceded, clean_sheet, breakdown
from public.match_performance_detail
where session_id = '<session-uuid>'::uuid order by player_name, match_number;

select * from public.valid_performance_votes
where session_id = '<session-uuid>'::uuid;

select player_id, match_points, nomination_points, final_rating
from public.session_performance_results
where final_rating > 100 or match_points > 40 or nomination_points > 60;
-- The final query must return no rows.
```
