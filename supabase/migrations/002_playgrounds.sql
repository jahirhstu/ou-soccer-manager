create table if not exists public.playgrounds (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  address text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

grant all on table public.playgrounds to authenticated, service_role;

alter table public.sessions add column if not exists playground_id uuid references public.playgrounds(id) on delete set null;

insert into public.playgrounds(name)
select distinct trim(location)
from public.sessions
where location is not null and trim(location) <> ''
on conflict (name) do nothing;

update public.sessions s
set playground_id = p.id
from public.playgrounds p
where s.playground_id is null
  and s.location is not null
  and trim(s.location) = p.name;

create index if not exists playgrounds_name_idx on public.playgrounds(name);
create index if not exists sessions_playground_id_idx on public.sessions(playground_id);

drop trigger if exists playgrounds_updated_at on public.playgrounds;
create trigger playgrounds_updated_at before update on public.playgrounds for each row execute function public.set_updated_at();

alter table public.playgrounds enable row level security;

drop policy if exists "playgrounds_select" on public.playgrounds;
create policy "playgrounds_select" on public.playgrounds for select using (auth.uid() is not null);

drop policy if exists "playgrounds_admin_all" on public.playgrounds;
create policy "playgrounds_admin_all" on public.playgrounds for all using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

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
  where coalesce(g.goal_type, 'goal') = 'goal'
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
    and coalesce(g.goal_type, 'goal') = 'goal'
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

grant select on table public.player_playground_stats_summary to authenticated, service_role;
