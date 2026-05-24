alter table public.goals
  add column if not exists goal_type text not null default 'goal';

alter table public.goals
  drop constraint if exists goals_goal_type_check;

alter table public.goals
  add constraint goals_goal_type_check check (goal_type in ('goal', 'own_goal'));

create or replace view public.player_season_stats_summary
with (security_invoker = true) as
select
  p.id player_id,
  p.display_name player_name,
  s.id season_id,
  s.name season_name,
  count(distinct a.session_id) filter (where a.status in ('played','replacement'))::integer appearances,
  coalesce(sum(g.goal_count),0)::integer goals,
  count(ga.id)::integer assists
from public.players p
cross join public.seasons s
left join public.sessions ss on ss.season_id = s.id
left join public.attendance a on a.player_id = p.id and a.session_id = ss.id
left join public.goals g on g.scorer_id = p.id and g.session_id = ss.id and g.goal_type = 'goal'
left join public.goals ga on ga.assist_player_id = p.id and ga.session_id = ss.id and ga.goal_type = 'goal'
group by p.id, p.display_name, s.id, s.name;

create or replace view public.player_playground_stats_summary
with (security_invoker = true) as
with playground_metrics as (
  select
    a.player_id,
    ss.playground_id,
    coalesce(pg.name, ss.location, 'Unknown playground') playground_name,
    0::integer goals,
    0::integer assists,
    count(distinct a.session_id) filter (where a.status in ('played','replacement'))::integer appearances
  from public.attendance a
  join public.sessions ss on ss.id = a.session_id
  left join public.playgrounds pg on pg.id = ss.playground_id
  group by a.player_id, ss.playground_id, coalesce(pg.name, ss.location, 'Unknown playground')
  union all
  select
    g.scorer_id player_id,
    ss.playground_id,
    coalesce(pg.name, ss.location, 'Unknown playground') playground_name,
    coalesce(sum(g.goal_count),0)::integer goals,
    0::integer assists,
    0::integer appearances
  from public.goals g
  join public.sessions ss on ss.id = g.session_id
  left join public.playgrounds pg on pg.id = ss.playground_id
  where g.goal_type = 'goal'
  group by g.scorer_id, ss.playground_id, coalesce(pg.name, ss.location, 'Unknown playground')
  union all
  select
    g.assist_player_id player_id,
    ss.playground_id,
    coalesce(pg.name, ss.location, 'Unknown playground') playground_name,
    0::integer goals,
    count(g.id)::integer assists,
    0::integer appearances
  from public.goals g
  join public.sessions ss on ss.id = g.session_id
  left join public.playgrounds pg on pg.id = ss.playground_id
  where g.assist_player_id is not null
    and g.goal_type = 'goal'
  group by g.assist_player_id, ss.playground_id, coalesce(pg.name, ss.location, 'Unknown playground')
),
summarized as (
  select
    player_id,
    playground_id,
    playground_name,
    sum(goals)::integer goals,
    sum(assists)::integer assists,
    sum(appearances)::integer appearances
  from playground_metrics
  group by player_id, playground_id, playground_name
)
select
  p.id player_id,
  p.display_name player_name,
  s.playground_id,
  s.playground_name,
  s.goals,
  s.assists,
  s.appearances,
  case when s.appearances > 0 then round(s.goals::numeric / s.appearances, 2) else 0 end goals_per_appearance
from summarized s
join public.players p on p.id = s.player_id;

drop function if exists public.public_player_report();

create or replace function public.public_player_report()
returns table(
  player_id uuid,
  player_name text,
  season_id uuid,
  season_name text,
  total_paid_amount numeric,
  total_played_sessions numeric,
  estimated_used_amount numeric,
  credit_amount numeric,
  owes_money numeric,
  balance_amount numeric,
  goals integer,
  assists integer,
  appearances integer,
  last_attended_sessions text[]
)
language sql stable security definer set search_path = public as $$
  with payment_totals as (
    select pay.player_id, pay.season_id, coalesce(sum(pay.amount),0) total_paid_amount
    from public.payments pay
    group by pay.player_id, pay.season_id
  ),
  played as (
    select
      a.player_id,
      s.season_id,
      count(*) filter (where a.status in ('played','replacement'))::numeric total_played_sessions,
      coalesce(sum(coalesce(s.price_per_session, seasons.price_per_session)) filter (where a.status in ('played','replacement')),0) estimated_used_amount
    from public.attendance a
    join public.sessions s on s.id = a.session_id
    join public.seasons seasons on seasons.id = s.season_id
    group by a.player_id, s.season_id
  ),
  scored as (
    select g.scorer_id as player_id, s.season_id, coalesce(sum(g.goal_count),0)::integer goals
    from public.goals g
    join public.sessions s on s.id = g.session_id
    where g.goal_type = 'goal'
    group by g.scorer_id, s.season_id
  ),
  assisted as (
    select g.assist_player_id as player_id, s.season_id, count(g.id)::integer assists
    from public.goals g
    join public.sessions s on s.id = g.session_id
    where g.assist_player_id is not null
      and g.goal_type = 'goal'
    group by g.assist_player_id, s.season_id
  ),
  last_sessions as (
    select
      ranked.player_id,
      ranked.season_id,
      array_agg(ranked.session_label order by ranked.session_date desc) last_attended_sessions
    from (
      select
        a.player_id,
        s.season_id,
        s.session_date,
        coalesce(nullif(s.name, ''), s.session_date::text) session_label,
        row_number() over (partition by a.player_id, s.season_id order by s.session_date desc, s.created_at desc) rn
      from public.attendance a
      join public.sessions s on s.id = a.session_id
      where a.status in ('played','replacement')
    ) ranked
    where ranked.rn <= 3
    group by ranked.player_id, ranked.season_id
  )
  select
    p.id player_id,
    p.display_name player_name,
    s.id season_id,
    s.name season_name,
    coalesce(pt.total_paid_amount,0) total_paid_amount,
    coalesce(pl.total_played_sessions,0) total_played_sessions,
    coalesce(pl.estimated_used_amount,0) estimated_used_amount,
    greatest(coalesce(pt.total_paid_amount,0) - coalesce(pl.estimated_used_amount,0), 0) credit_amount,
    greatest(coalesce(pl.estimated_used_amount,0) - coalesce(pt.total_paid_amount,0), 0) owes_money,
    coalesce(pt.total_paid_amount,0) - coalesce(pl.estimated_used_amount,0) balance_amount,
    coalesce(sc.goals,0) goals,
    coalesce(ast.assists,0) assists,
    coalesce(pl.total_played_sessions,0)::integer appearances,
    coalesce(ls.last_attended_sessions, array[]::text[]) last_attended_sessions
  from public.players p
  cross join public.seasons s
  left join payment_totals pt on pt.player_id = p.id and pt.season_id = s.id
  left join played pl on pl.player_id = p.id and pl.season_id = s.id
  left join scored sc on sc.player_id = p.id and sc.season_id = s.id
  left join assisted ast on ast.player_id = p.id and ast.season_id = s.id
  left join last_sessions ls on ls.player_id = p.id and ls.season_id = s.id
  where p.status = 'active'
    and (
      coalesce(pt.total_paid_amount,0) > 0
      or coalesce(pl.total_played_sessions,0) > 0
      or coalesce(sc.goals,0) > 0
      or coalesce(ast.assists,0) > 0
    )
  order by s.start_date desc nulls last, s.name, p.display_name;
$$;

grant execute on function public.public_player_report() to anon, authenticated, service_role;
