# Position Performance and Captain Voting

## Availability

Implemented on the website and in the shared Match Day package used by OU Sports
and OU Manager. Existing draft skill percentages, goals/assists rankings, payments,
attendance and team formation remain separate and unchanged.

- Website: Session > Performance & voting; score entry links to match positions.
- Dashboard: latest completed session awards and position leaderboard link.
- Player page: performance and position history, with session breakdown links.
- OU Sports / OU Manager: Session actions > Match ratings & votes.
- OU Sports: Statistics and Account > performance history.
- OU Manager: Dashboard / Program > Position leaderboards & match ratings.

## Match Workflow

1. Save teams and fixtures using the existing workflows.
2. Confirm participation and position for each match. Positions are not permanent.
   Copy previous match positions pre-fills only earlier confirmed entries for players
   in the current match; review and confirm before saving.
3. Record scorer, assist, and opposing goalkeeper. A unique confirmed opposing
   goalkeeper is suggested; multiple keepers require an explicit choice.
4. Mark scoreless games played using the existing scoring control.
5. Complete the session. Its actual team captains can submit nominations.

No historical positions or participation are inferred. An unconfirmed roster
member has no performance appearance. A confirmed participant with unknown position
counts as an appearance but contributes zero to the session numerator and is marked
incomplete. Non-participants do not enter the denominator. This deliberately avoids
inflating ratings by discarding unknown appearances.

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
No match count is hardcoded. Captain points = min(60, 30 × valid nominations).
The session final is bounded to 100. Forward-only participants cannot receive votes
and retain a maximum of 40. Players who switch positions may receive nominations
only for non-forward positions they actually played; their combined captain bonus
remains capped at 60 across categories.

Season position leaderboards rank mean position-specific session ratings, not raw
appearance totals. Each position/session is normalized to 40 and receives only that
category's nomination points. Match averages, appearances, sessions and nomination
counts are shown separately. Forward rankings have a 40-point maximum.

## Voting and Authorization

- Voting opens only when the session is completed.
- An active program membership must link the signed-in account to that saved team's
  captain player ID. Organization admin status alone does not grant a captain ballot.
- A nominee must have confirmed participation at the nominated position in a played
  match and cannot belong to the captain's own saved team.
- One stored vote per session/team/category. Resubmission updates that vote, never
  creates duplicate points. Edits are allowed until a manager closes voting.
- Managers may reopen voting. Changes and voting status are audited.
- All tied leaders with at least one valid nomination are returned. Incomplete
  ballots are not filled automatically; awards remain provisional while voting is open.
- Corrections to participation/positions can invalidate a vote; original vote rows
  remain stored but do not contribute until eligible again. Closed voting freezes
  ballot edits, not the underlying corrected match facts.

All writes validate scope in database functions. New tables have RLS and no direct
authenticated write grants. Results are authenticated, program-scoped reads, not new
anonymous public endpoints. UI permissions do not replace database checks.

## Recalculation and Safety

Ratings are live SQL views, not incremented totals. Goal, assist, result, position,
keeper and vote corrections are reflected on the next read. Website and mobile
scoring use the same atomic save path. Match IDs survive score corrections so
positions are retained. An invalid goalkeeper rejects the whole save. Change a
goal's keeper assignment before removing that keeper's confirmed position.

## Deployment

New migrations, in order:

1. `096_empty_program_context_uuid.sql`: pooled authorization-setting UUID fix.
2. `097_match_performance.sql`: positions, votes, scoped APIs, audit and calculations.
3. `098_performance_goal_entry.sql`: atomic score save preserving match IDs and keeper round-trip.

There must be only one migration numbered 096. The duplicate earlier draft was
removed during conflict resolution. If any environment has already recorded a
different 096 filename, inspect migration history before deploying; do not replay
both versions blindly.

These changes have not been applied to production. Back up the target database,
apply migrations before deploying the updated clients, then verify a test session.
There is no automatic historical backfill. Financial data is not modified.

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
attribution; correction rollback; captain edits, ties, 30/60 points and closed voting;
season averages; and unauthorized writes/reads. UI tests cover eligibility, tied
awards, point breakdowns, empty results and closed/read-only controls.

Physical-device checks remain necessary for both apps: open a saved session, confirm
positions, select a keeper, save scores, complete the session, submit/edit a ballot,
close voting, switch programs and verify the season/profile results. No physical
iOS/Android test is claimed by this implementation.

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

select player_id, match_points, captain_points, final_rating
from public.session_performance_results
where final_rating > 100 or match_points > 40 or captain_points > 60;
-- The final query must return no rows.
```
