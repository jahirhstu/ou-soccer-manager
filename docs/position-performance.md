# Position-Based Player Performance Ratings

## Website behavior

Session Details > Ratings shows player match breakdowns, session ratings, and
nomination points. It does not provide match-by-match position or participation
confirmation. Game scoring continues to record scorer, assist, scorer position,
and the opposing player credited as goalkeeper for each conceded goal. Any
opposing-team player can be selected as goalkeeper without a position confirmation.

The website's position resolver uses each match's scoring events first. It uses
all distinct scorer positions and adds goalkeeper for each player named as the
conceding goalkeeper. If no event position exists, the player's session lineup
position is used; the player profile default is the final fallback. Sources are
never mixed. Legacy manual match-position records do not affect website ratings.

The shared manual-position table and RPC remain for the existing native clients;
the website no longer renders, calls, or uses that workflow. Native applications
were not modified.

The website's Guided team draft uses a separate, session-scoped category override
based on each player's profile position. Organizers may adjust or reset those
draft categories without changing profile positions; the overrides do not affect
lineups, match positions, or performance ratings.

## Match rating

Each match rates at most 10 points. For a match, `R` is 2 for a win, 1 for a draw,
and 0 for a loss; `GF` and `GA` are the player's team's scored and conceded goals;
`GC` is the goal count assigned to that specific goalkeeper; `G` and `A` are the
player's goal and assist counts. A zero-goal-against team has `CS = 1`.

| Position | Base rating |
| --- | --- |
| Goalkeeper | `8 / (1 + 0.5 × GC) + R` |
| Defender | `6 / (1 + 0.5 × GA) + R` |
| Midfielder | `0.75 × min(GF, 4) + 2 × CS + R` |
| Forward | `0.75 × min(GF, 4) + R` |

When scoring events identify multiple distinct positions, their base ratings
receive equal weight. Goal and assist contribution is added once:
`min(2 × G + A, highest position cap)`, with caps of 2 for goalkeeper/defender,
3 for midfielder, and 5 for forward. The final match rating is the weighted base
average plus individual points, capped at 10.

Goalkeeper concessions follow the goalkeeper recorded in each goal event, so
multiple keepers can rotate in one match. A goalkeeper rating is marked
provisional if team concessions are not fully attributed. No full-match goalkeeper
clean-sheet credit is awarded because event data does not establish full-match
participation.

For each player, session match points are
`sum(match ratings) / (10 × matches played) × 40`. Matches played are derived
from the player's session team roster and the match fixture; the match count is
not hardcoded. A player with no played matches has no performance result.
Calculations retain numeric precision; the website rounds only for display.

## Nominations and rankings

Top Goalkeeper, Top Defender, and Top Midfielder nominations retain their existing
eligibility, submission, and voting-close behavior. Each category distributes up
to 60 points using `min(20, 60 / valid votes in category)` per vote. A player's
combined nomination points are capped at 60. Final session ratings combine the
40-point match component and 60-point nomination component, for a 100-point cap.
Nominees are eligible for every position actually resolved for them in a match.
Session and season rankings use the recalculated ratings.

## Data and deployment

Migration `104_event_based_position_ratings.sql` adds the per-goal scorer position,
backfills that value from historical score-position records where available,
relaxes goalkeeper validation to opposing-team roster membership, and replaces
the performance calculation with event-based resolution. Historical goal rows
are preserved. Existing score-position records are retained as historical data
but are no longer used for ratings.

Deploy migration 104 before the website build. No native application changes are
included. The shared `match_player_positions` table and `confirm_match_positions`
RPC remain because the existing native clients still use them; website ratings,
score saving, and UI no longer depend on manual match-position confirmation.

## Verification

Database tests cover position-source priority, distinct multi-position weighting,
goalkeeper rotation and per-goal concessions, goals and assists, incomplete
goalkeeper attribution, different match counts, session normalization, and
nomination point caps. Website tests cover unrestricted opposing-player selection,
rating breakdowns, multi-position nomination eligibility, and removal of the
match-position management section.

For a deployed test session, verify score corrections update event positions and
ratings, goalkeepers rotate without a confirmed position, nominations still close
and reopen, and the dashboard/session rankings reflect updated ratings.

Example read-only checks:

```sql
select player_name, matches_played, positions, match_points,
       nomination_points, final_rating, incomplete
from public.session_performance_results
where session_id = '<session-uuid>'::uuid
order by final_rating desc;

select player_name, match_number, positions, goals_for, goals_against, goals,
       assists, keeper_conceded, keeper_attribution_incomplete, breakdown
from public.match_performance_detail
where session_id = '<session-uuid>'::uuid
order by player_name, match_number;

select player_id, match_points, nomination_points, final_rating
from public.session_performance_results
where final_rating > 100 or match_points > 40 or nomination_points > 60;
-- The final query must return no rows.
```
