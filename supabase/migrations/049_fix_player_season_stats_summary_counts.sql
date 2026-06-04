create or replace view public.player_season_stats_summary
with (security_invoker = true) as
with appearances as (
  select
    a.player_id,
    ss.season_id,
    count(distinct a.session_id) filter (where a.status in ('played','replacement'))::integer appearances
  from public.attendance a
  join public.sessions ss on ss.id = a.session_id
  group by a.player_id, ss.season_id
),
goal_totals as (
  select
    g.scorer_id player_id,
    ss.season_id,
    coalesce(sum(g.goal_count), 0)::integer goals
  from public.goals g
  join public.sessions ss on ss.id = g.session_id
  where g.goal_type = 'goal'
  group by g.scorer_id, ss.season_id
),
assist_totals as (
  select
    g.assist_player_id player_id,
    ss.season_id,
    count(g.id)::integer assists
  from public.goals g
  join public.sessions ss on ss.id = g.session_id
  where g.goal_type = 'goal'
    and g.assist_player_id is not null
  group by g.assist_player_id, ss.season_id
)
select
  p.id player_id,
  p.display_name player_name,
  s.id season_id,
  s.name season_name,
  coalesce(a.appearances, 0)::integer appearances,
  coalesce(gt.goals, 0)::integer goals,
  coalesce(at.assists, 0)::integer assists
from public.players p
cross join public.seasons s
left join appearances a on a.player_id = p.id and a.season_id = s.id
left join goal_totals gt on gt.player_id = p.id and gt.season_id = s.id
left join assist_totals at on at.player_id = p.id and at.season_id = s.id;
