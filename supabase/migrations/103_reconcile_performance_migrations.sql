-- Reconcile the legacy production performance schema without replaying migrations 097-102.
-- Legacy source tables remain intact; ambiguous match-position rows are archived before cleanup.
DO $$
DECLARE
  has_legacy_position_audit boolean;
BEGIN
  IF to_regclass('public.sessions') IS NULL
     OR to_regclass('public.session_matches') IS NULL
     OR to_regclass('public.session_teams') IS NULL
     OR to_regclass('public.session_team_players') IS NULL
     OR to_regclass('public.players') IS NULL
     OR to_regclass('public.goals') IS NULL THEN
    RAISE EXCEPTION 'Migration 103 requires the existing session and scoring schema';
  END IF;

  IF to_regclass('public.performance_audit') IS NOT NULL THEN
    EXECUTE $query$
      SELECT EXISTS (
        SELECT 1
        FROM public.performance_audit
        WHERE action ILIKE '%position%'
           OR (payload ? 'matchId' AND payload ? 'players')
      )
    $query$ INTO has_legacy_position_audit;
    IF has_legacy_position_audit THEN
      RAISE EXCEPTION 'Migration 103 found legacy position audit entries; review their payload before reconciling match positions';
    END IF;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.match_player_positions_legacy_archive (
  match_id uuid NOT NULL,
  player_id uuid NOT NULL,
  session_team_id uuid NOT NULL,
  position text,
  participated boolean NOT NULL,
  confirmed_by uuid NOT NULL,
  updated_at timestamptz NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  archive_reason text NOT NULL,
  PRIMARY KEY (match_id, player_id)
);


-- Reconciled source: 097_match_performance.sql
-- Confirmed match participation is separate from team membership and draft skill ratings.
create table if not exists public.match_player_positions (
  match_id uuid not null references public.session_matches(id) on delete cascade,
  player_id uuid not null references public.players(id),
  session_team_id uuid not null references public.session_teams(id) on delete cascade,
  position text check (position in ('goalkeeper','defender','midfielder','forward')),
  participated boolean not null default true,
  confirmed_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key(match_id,player_id)
);
create index if not exists match_player_positions_player_id_match_id_idx on public.match_player_positions(player_id,match_id);
create table if not exists public.session_performance_voting (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  closed boolean not null default false,
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now()
);
create table if not exists public.captain_performance_votes (
  session_id uuid not null references public.sessions(id) on delete cascade,
  captain_team_id uuid not null references public.session_teams(id) on delete cascade,
  category text not null check(category in ('goalkeeper','defender','midfielder')),
  player_id uuid not null references public.players(id),
  voter_id uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key(session_id,captain_team_id,category)
);
create table if not exists public.performance_changes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  action text not null,
  details jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.goals add column if not exists conceded_goalkeeper_id uuid references public.players(id);
create index if not exists goals_conceded_goalkeeper_id_idx on public.goals(conceded_goalkeeper_id) where conceded_goalkeeper_id is not null;
alter table public.match_player_positions enable row level security;
alter table public.session_performance_voting enable row level security;
alter table public.captain_performance_votes enable row level security;
alter table public.performance_changes enable row level security;

create or replace function public.performance_access(p_program uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select auth.uid() is not null and public.is_program_module_enabled(p_program,'scores') and (public.mobile_program_access(p_program)
    or coalesce(public.program_role(p_program)='manager',false));
$$;
drop policy if exists performance_position_read on public.match_player_positions;
create policy performance_position_read on public.match_player_positions for select to authenticated
  using(exists(select 1 from public.session_matches m join public.sessions s on s.id=m.session_id
    where m.id=match_id and public.performance_access(s.program_id)));

-- Versioned, numeric-only scoring. Unknown positions deliberately have no rating.
create or replace function public.match_performance_points_v1(p_position text,p_for integer,p_against integer,
  p_goals integer,p_assists integer,p_keeper_conceded integer)
returns jsonb language sql immutable as $$
  with parts as (select
    2::numeric base,
    case when p_for>p_against then 2 when p_for=p_against then 1 else 0 end result,
    case when p_against=0 then case p_position when 'goalkeeper' then 4 when 'defender' then 3 when 'midfielder' then 1 else 0 end else 0 end defense,
    least(2::numeric,p_for*case p_position when 'goalkeeper' then 0.10 when 'defender' then 0.15 when 'midfielder' then 0.25 else 0.50 end) attack,
    least(4::numeric,p_goals*case p_position when 'goalkeeper' then 2 when 'defender' then 1 when 'midfielder' then 1.5 else 2.5 end
      +p_assists*case p_position when 'goalkeeper' then 1 when 'defender' then 0.75 when 'midfielder' then 1.5 else 1.5 end) individual,
    case p_position when 'goalkeeper' then least(4,coalesce(p_keeper_conceded,p_against)*0.75)
      when 'defender' then least(3,p_against*0.50) when 'midfielder' then least(2,p_against*0.25) else 0 end penalty)
  select case when p_position is null then jsonb_build_object('version',1,'rating',null)
    else jsonb_build_object('version',1,'base',base,'result',result,'defense',defense,'attack',attack,
      'individual',individual,'penalty',penalty,'rating',round(greatest(0,least(10,base+result+defense+attack+individual-penalty)),2)) end from parts;
$$;

create or replace function public.validate_conceded_goalkeeper() returns trigger
language plpgsql set search_path=public as $$
begin
  if new.conceded_goalkeeper_id is not null and not exists (
    select 1 from public.match_player_positions p join public.session_matches m on m.id=p.match_id
    where p.match_id=new.match_id and p.player_id=new.conceded_goalkeeper_id
      and p.position='goalkeeper' and p.participated
      and p.session_team_id in (m.team_a_id,m.team_b_id) and p.session_team_id<>new.session_team_id
      and exists(select 1 from public.session_team_players roster where roster.session_id=m.session_id and roster.player_id=p.player_id and roster.session_team_id=p.session_team_id)
  ) then raise exception 'Select a confirmed opposing goalkeeper for this match'; end if;
  return new;
end;
$$;
drop trigger if exists validate_goalkeeper on public.goals;
create trigger validate_goalkeeper before insert or update on public.goals
for each row execute function public.validate_conceded_goalkeeper();

create or replace function public.confirm_match_positions(p_match_id uuid,p_players jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare m public.session_matches; s public.sessions; item jsonb; pid uuid; tid uuid; pos text;
begin
  select * into m from public.session_matches where id=p_match_id;
  select * into s from public.sessions where id=m.session_id for update;
  select * into m from public.session_matches where id=p_match_id for update;
  if not coalesce(public.performance_access(s.program_id) and public.program_role(s.program_id) in ('manager','captain')
    and public.is_program_module_enabled(s.program_id,'scores'),false) then raise exception 'Score management access required'; end if;
  if jsonb_typeof(p_players) is distinct from 'array' or jsonb_array_length(p_players)=0 then raise exception 'Provide match participants'; end if;
  if (select count(*)<>count(distinct value->>'playerId') from jsonb_array_elements(p_players)) then raise exception 'Duplicate player'; end if;
  for item in select value from jsonb_array_elements(p_players) loop
    pid:=(item->>'playerId')::uuid; pos:=nullif(item->>'position','');
    select session_team_id into tid from public.session_team_players where session_id=s.id and player_id=pid;
    if tid is null or tid not in (m.team_a_id,m.team_b_id) then raise exception 'Player is not on a participating team'; end if;
    if exists(select 1 from public.goals where match_id=m.id and conceded_goalkeeper_id=pid)
      and (pos is distinct from 'goalkeeper' or not coalesce((item->>'participated')::boolean,true)) then
      raise exception 'Correct goalkeeper assignments on goals before changing this position';
    end if;
    insert into public.match_player_positions(match_id,player_id,session_team_id,position,participated,confirmed_by)
    values(m.id,pid,tid,pos,coalesce((item->>'participated')::boolean,true),auth.uid())
    on conflict(match_id,player_id) do update set session_team_id=excluded.session_team_id,
      position=excluded.position,participated=excluded.participated,confirmed_by=auth.uid(),updated_at=now();
  end loop;
  insert into public.performance_changes(session_id,actor_id,action,details) values(s.id,auth.uid(),'positions',jsonb_build_object('matchId',m.id,'players',p_players));
end;
$$;

-- Views are private: only scoped RPCs below expose their results.
DO $view_guard$
BEGIN
  IF to_regclass('public.match_performance_detail') IS NULL THEN
    EXECUTE $view_ddl$create view public.match_performance_detail as
with facts as (
  select s.id session_id,s.season_id,s.program_id,m.id match_id,m.match_number,p.player_id,
    pl.display_name player_name,p.session_team_id,p.position,
    case when p.session_team_id=m.team_a_id then m.team_a_score else m.team_b_score end goals_for,
    case when p.session_team_id=m.team_a_id then m.team_b_score else m.team_a_score end goals_against,
    coalesce(ind.g,0)::integer goals,coalesce(ind.a,0)::integer assists,
    case when p.position='goalkeeper' and coalesce(ga.attributed,0)=case when p.session_team_id=m.team_a_id then m.team_b_score else m.team_a_score end then coalesce(k.n,0)::integer end keeper_conceded,
    p.position='goalkeeper' and (case when p.session_team_id=m.team_a_id then m.team_b_score else m.team_a_score end)=0 clean_sheet,
    coalesce(ga.attributed,0)<>(case when p.session_team_id=m.team_a_id then m.team_b_score else m.team_a_score end) and p.position='goalkeeper' keeper_attribution_incomplete
  from public.match_player_positions p
  join public.session_matches m on m.id=p.match_id and m.result_status='played'
  join public.sessions s on s.id=m.session_id
  join public.players pl on pl.id=p.player_id
  join public.session_team_players roster on roster.session_id=s.id and roster.player_id=p.player_id and roster.session_team_id=p.session_team_id
  left join lateral(select sum(goal_count) filter(where conceded_goalkeeper_id is not null) attributed from public.goals where match_id=m.id and session_team_id<>p.session_team_id) ga on true
  left join lateral(select sum(goal_count) filter(where scorer_id=p.player_id and goal_type='goal') g,
    sum(goal_count) filter(where assist_player_id=p.player_id and goal_type='goal') a from public.goals where match_id=m.id) ind on true
  left join lateral(select sum(goal_count) n from public.goals where match_id=m.id and conceded_goalkeeper_id=p.player_id) k on true
  where p.participated and p.session_team_id in(m.team_a_id,m.team_b_id)
)
select *,public.match_performance_points_v1(position,goals_for,goals_against,goals,assists,keeper_conceded) breakdown from facts;$view_ddl$;
  END IF;
END;
$view_guard$;


DO $view_guard$
BEGIN
  IF to_regclass('public.valid_performance_votes') IS NULL THEN
    EXECUTE $view_ddl$create view public.valid_performance_votes as
select v.* from public.captain_performance_votes v
join public.sessions s on s.id=v.session_id and s.status='completed'
join public.session_teams captain on captain.id=v.captain_team_id and captain.session_id=s.id
where exists(select 1 from public.program_members pm where pm.program_id=s.program_id and pm.profile_id=v.voter_id
  and pm.status='active' and pm.player_id=captain.captain_player_id)
and exists(select 1 from public.match_performance_detail d where d.session_id=s.id and d.player_id=v.player_id and d.position=v.category)
and not exists(select 1 from public.session_team_players own where own.session_id=s.id and own.session_team_id=captain.id and own.player_id=v.player_id);$view_ddl$;
  END IF;
END;
$view_guard$;


DO $view_guard$
BEGIN
  IF to_regclass('public.session_performance_results') IS NULL THEN
    EXECUTE $view_ddl$create view public.session_performance_results as
select d.session_id,d.season_id,d.program_id,d.player_id,d.player_name,
  count(*)::integer matches_played,count(*) filter(where position is not null)::integer rated_matches,
  array_agg(distinct position) filter(where position is not null) positions,
  round(sum(coalesce((breakdown->>'rating')::numeric,0))*4/count(*),2) match_points,
  least(60,coalesce(v.n,0)*30)::integer captain_points,
  round(sum(coalesce((breakdown->>'rating')::numeric,0))*4/count(*)+least(60,coalesce(v.n,0)*30),2) final_rating,
  sum(goals)::integer goals,sum(assists)::integer assists,
  count(*) filter(where clean_sheet)::integer clean_sheets,
  sum(keeper_conceded)::integer keeper_conceded,
  bool_or(position is null or keeper_attribution_incomplete) incomplete
from public.match_performance_detail d
left join lateral(select count(*) n from public.valid_performance_votes v where v.session_id=d.session_id and v.player_id=d.player_id) v on true
group by d.session_id,d.season_id,d.program_id,d.player_id,d.player_name,v.n;$view_ddl$;
  END IF;
END;
$view_guard$;


create or replace function public.nominate_session_player(p_session_id uuid,p_team_id uuid,p_category text,p_player_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare s public.sessions;
begin
  select * into s from public.sessions where id=p_session_id for update;
  if not coalesce(public.performance_access(s.program_id),false) then raise exception 'Program access required'; end if;
  if s.status<>'completed' then raise exception 'Voting opens after session completion'; end if;
  if exists(select 1 from public.session_performance_voting where session_id=s.id and closed) then raise exception 'Voting is closed'; end if;
  if not exists(select 1 from public.session_teams t join public.program_members pm on pm.program_id=s.program_id
    and pm.player_id=t.captain_player_id and pm.profile_id=auth.uid() and pm.status='active'
    where t.id=p_team_id and t.session_id=s.id) then raise exception 'Only this team captain may vote'; end if;
  if exists(select 1 from public.session_team_players where session_id=s.id and session_team_id=p_team_id and player_id=p_player_id)
    or not exists(select 1 from public.match_performance_detail where session_id=s.id and player_id=p_player_id and position=p_category)
    then raise exception 'Nominee must have played this position on another team'; end if;
  insert into public.captain_performance_votes(session_id,captain_team_id,category,player_id,voter_id)
    values(s.id,p_team_id,p_category,p_player_id,auth.uid())
    on conflict(session_id,captain_team_id,category) do update set player_id=excluded.player_id,voter_id=auth.uid(),updated_at=now();
  insert into public.performance_changes(session_id,actor_id,action,details)
    values(s.id,auth.uid(),'nomination',jsonb_build_object('teamId',p_team_id,'category',p_category,'playerId',p_player_id));
end;
$$;

create or replace function public.close_performance_voting(p_session_id uuid,p_closed boolean) returns void
language plpgsql security definer set search_path=public as $$
declare s public.sessions;
begin
  select * into s from public.sessions where id=p_session_id for update;
  if not coalesce(public.performance_access(s.program_id) and public.program_role(s.program_id)='manager',false) then raise exception 'Manager access required'; end if;
  insert into public.session_performance_voting(session_id,closed,updated_by) values(s.id,p_closed,auth.uid())
    on conflict(session_id) do update set closed=excluded.closed,updated_by=auth.uid(),updated_at=now();
  insert into public.performance_changes(session_id,actor_id,action,details) values(s.id,auth.uid(),'voting_status',jsonb_build_object('closed',p_closed));
end;
$$;

create or replace function public.session_performance(p_session_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare s public.sessions; answer jsonb;
begin
  select * into s from public.sessions where id=p_session_id;
  if not coalesce(public.performance_access(s.program_id),false) then raise exception 'Program access required'; end if;
  select jsonb_build_object('session',jsonb_build_object('id',s.id,'name',s.name,'status',s.status,'seasonId',s.season_id),
    'canManage',public.program_role(s.program_id) in ('manager','captain') and public.is_program_module_enabled(s.program_id,'scores'),
    'canClose',public.program_role(s.program_id)='manager',
    'closed',coalesce((select closed from public.session_performance_voting where session_id=s.id),false),
    'teams',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'canVote',exists(select 1 from public.program_members pm
      where pm.program_id=s.program_id and pm.profile_id=auth.uid() and pm.status='active' and pm.player_id=t.captain_player_id),
      'players',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name)),'[]') from public.session_team_players tp join public.players p on p.id=tp.player_id where tp.session_team_id=t.id)))
      from public.session_teams t where t.session_id=s.id),'[]'),
    'matches',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'number',m.match_number,'teamAId',m.team_a_id,'teamBId',m.team_b_id,'status',m.result_status) order by m.match_number) from public.session_matches m where m.session_id=s.id),'[]'),
    'positions',coalesce((select jsonb_agg(to_jsonb(p)) from public.match_player_positions p join public.session_matches m on m.id=p.match_id where m.session_id=s.id),'[]'),
    'results',coalesce((select jsonb_agg(to_jsonb(r) order by final_rating desc,player_name) from public.session_performance_results r where r.session_id=s.id),'[]'),
    'details',coalesce((select jsonb_agg(to_jsonb(d) order by match_number,player_name) from public.match_performance_detail d where d.session_id=s.id),'[]'),
    'votes',coalesce((select jsonb_agg(to_jsonb(v)) from public.valid_performance_votes v where v.session_id=s.id),'[]'),
    'awards',coalesce((select jsonb_agg(to_jsonb(w)) from (
      select category,player_id,p.display_name player_name,count(*) nominations,
        dense_rank() over(partition by category order by count(*) desc) rank
      from public.valid_performance_votes v join public.players p on p.id=v.player_id where v.session_id=s.id group by category,player_id,p.display_name
    ) w where rank=1),'[]')) into answer;
  return answer;
end;
$$;

create or replace function public.season_performance(p_season_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare program uuid;
begin
  select program_id into program from public.seasons where id=p_season_id;
  if not coalesce(public.performance_access(program),false) then raise exception 'Program access required'; end if;
  return coalesce((select jsonb_agg(to_jsonb(r) order by position,average_session_rating desc,player_name) from (
    select d.player_id,d.player_name,d.position,count(*) matches_played,count(distinct d.session_id) sessions_played,
      round(avg((d.breakdown->>'rating')::numeric),2) average_match_rating,
      (select round(avg(position_session.points),2) from (
        select avg((pm.breakdown->>'rating')::numeric)*4 + least(60,30*(select count(*) from public.valid_performance_votes v
          where v.session_id=pm.session_id and v.player_id=pm.player_id and v.category=pm.position)) points
        from public.match_performance_detail pm where pm.season_id=p_season_id and pm.player_id=d.player_id and pm.position=d.position
        group by pm.session_id,pm.player_id,pm.position
      ) position_session) average_session_rating,
      (select count(*) from public.valid_performance_votes v join public.sessions s on s.id=v.session_id
        where s.season_id=p_season_id and v.player_id=d.player_id and v.category=d.position) nominations
    from public.match_performance_detail d where d.season_id=p_season_id and d.position is not null
    group by d.player_id,d.player_name,d.position
  ) r),'[]');
end;
$$;
revoke all on public.match_performance_detail,public.valid_performance_votes,public.session_performance_results from public,anon,authenticated;
revoke all on public.match_player_positions,public.session_performance_voting,public.captain_performance_votes,public.performance_changes from public,anon,authenticated;
grant select on public.match_player_positions to authenticated;
revoke all on function public.confirm_match_positions(uuid,jsonb),public.nominate_session_player(uuid,uuid,text,uuid),public.close_performance_voting(uuid,boolean),public.session_performance(uuid),public.season_performance(uuid) from public,anon;
grant execute on function public.confirm_match_positions(uuid,jsonb),public.nominate_session_player(uuid,uuid,text,uuid),public.close_performance_voting(uuid,boolean),public.session_performance(uuid),public.season_performance(uuid) to authenticated;

create or replace function public.player_performance_history(p_program_id uuid,p_player_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  if not coalesce(public.performance_access(p_program_id),false) then raise exception 'Program access required'; end if;
  return coalesce((select jsonb_agg(to_jsonb(r) order by session_date desc) from (
    select p.*,s.session_date,s.name session_name from public.session_performance_results p
    join public.sessions s on s.id=p.session_id where p.program_id=p_program_id and p.player_id=p_player_id
  ) r),'[]');
end;
$$;
revoke all on function public.player_performance_history(uuid,uuid) from public,anon;
grant execute on function public.player_performance_history(uuid,uuid) to authenticated;

-- Copy compatible legacy captain nominations without deleting or rewriting their source rows.
DO $$
DECLARE
  has_conflicting_votes boolean;
  has_closed_votes_without_actor boolean;
BEGIN
  IF to_regclass('public.performance_votes') IS NOT NULL THEN
    EXECUTE $query$
      SELECT EXISTS (
        SELECT 1
        FROM public.performance_votes legacy
        JOIN public.captain_performance_votes current_vote
          ON current_vote.session_id = legacy.session_id
         AND current_vote.captain_team_id = legacy.team_id
         AND current_vote.category = legacy.category
        WHERE current_vote.player_id IS DISTINCT FROM legacy.player_id
           OR current_vote.voter_id IS DISTINCT FROM legacy.voter_id
           OR current_vote.updated_at IS DISTINCT FROM legacy.updated_at
      )
    $query$ INTO has_conflicting_votes;
    IF has_conflicting_votes THEN
      RAISE EXCEPTION 'Conflicting legacy performance votes; reconcile them before migration 103';
    END IF;

    EXECUTE $query$
      INSERT INTO public.captain_performance_votes (
        session_id, captain_team_id, category, player_id, voter_id, updated_at
      )
      SELECT session_id, team_id, category, player_id, voter_id, updated_at
      FROM public.performance_votes
      ON CONFLICT (session_id, captain_team_id, category) DO NOTHING
    $query$;
  END IF;

  IF to_regclass('public.performance_voting') IS NOT NULL THEN
    IF to_regclass('public.performance_audit') IS NULL THEN
      EXECUTE $query$
        SELECT EXISTS (
          SELECT 1 FROM public.performance_voting legacy
          WHERE legacy.closed
            AND NOT EXISTS (
              SELECT 1 FROM public.session_performance_voting current_state
              WHERE current_state.session_id = legacy.session_id AND current_state.closed
            )
        )
      $query$ INTO has_closed_votes_without_actor;
    ELSE
      EXECUTE $query$
        SELECT EXISTS (
          SELECT 1 FROM public.performance_voting legacy
          WHERE legacy.closed
            AND NOT EXISTS (
              SELECT 1 FROM public.session_performance_voting current_state
              WHERE current_state.session_id = legacy.session_id AND current_state.closed
            )
            AND NOT EXISTS (
              SELECT 1 FROM public.performance_audit audit
              WHERE audit.session_id = legacy.session_id
                AND (
                  audit.action IN ('voting_status', 'close_voting', 'voting_closed')
                  OR audit.payload->>'closed' = 'true'
                )
            )
        )
      $query$ INTO has_closed_votes_without_actor;
    END IF;

    IF has_closed_votes_without_actor THEN
      RAISE EXCEPTION 'A closed legacy vote has no audit actor; cannot preserve close attribution';
    END IF;

    IF to_regclass('public.performance_audit') IS NOT NULL THEN
      EXECUTE $query$
        INSERT INTO public.session_performance_voting AS current_state
          (session_id, closed, updated_by, updated_at)
        SELECT legacy.session_id, true, audit.actor_id, audit.created_at
        FROM public.performance_voting legacy
        JOIN LATERAL (
          SELECT source.actor_id, source.created_at
          FROM public.performance_audit source
          WHERE source.session_id = legacy.session_id
            AND (
              source.action IN ('voting_status', 'close_voting', 'voting_closed')
              OR source.payload->>'closed' = 'true'
            )
          ORDER BY source.created_at DESC, source.id DESC
          LIMIT 1
        ) audit ON true
        WHERE legacy.closed
          AND NOT EXISTS (
            SELECT 1 FROM public.session_performance_voting current_state
            WHERE current_state.session_id = legacy.session_id AND current_state.closed
          )
        ON CONFLICT (session_id) DO UPDATE
          SET closed = true, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
          WHERE NOT current_state.closed
      $query$;
    END IF;
  END IF;
END;
$$;

-- Reconciled source: 099_website_performance_position_workflow.sql
create or replace function public.lineup_builder_teams(p_session_id uuid)
returns table(id uuid,name text,players jsonb)
language sql stable security definer set search_path=public as $$
  select st.id,st.name,coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'name',p.display_name,'preferredPosition',p.preferred_position
  ) order by p.display_name) filter(where p.id is not null),'[]'::jsonb)
  from public.session_teams st
  join public.session_team_players current_member on current_member.session_team_id=st.id
  left join public.session_team_players stp on stp.session_team_id=st.id
  left join public.players p on p.id=stp.player_id
  where st.session_id=p_session_id and current_member.session_id=p_session_id
    and current_member.player_id=public.current_player_id()
    and public.is_organization_member(st.organization_id)
  group by st.id,st.name
  order by st.name;
$$;

create or replace view public.match_performance_detail as
with facts as (
  select s.id session_id,s.season_id,s.program_id,m.id match_id,m.match_number,
    roster.player_id,pl.display_name player_name,roster.session_team_id,
    coalesce(
      match_position.position,
      case lower(btrim(lineup.position)) when 'goalkeeper' then 'goalkeeper' when 'defender' then 'defender'
        when 'midfielder' then 'midfielder' when 'forward' then 'forward' end,
      case lower(btrim(pl.preferred_position))
        when 'goalkeeper' then 'goalkeeper'
        when 'defender' then 'defender'
        when 'midfielder' then 'midfielder'
        when 'forward' then 'forward'
      end
    ) position,
    case when roster.session_team_id=m.team_a_id then m.team_a_score else m.team_b_score end goals_for,
    case when roster.session_team_id=m.team_a_id then m.team_b_score else m.team_a_score end goals_against,
    coalesce(ind.g,0)::integer goals,coalesce(ind.a,0)::integer assists,
    case when coalesce(match_position.position,case lower(btrim(lineup.position))
      when 'goalkeeper' then 'goalkeeper' when 'defender' then 'defender'
      when 'midfielder' then 'midfielder' when 'forward' then 'forward' end,case lower(btrim(pl.preferred_position))
      when 'goalkeeper' then 'goalkeeper' when 'defender' then 'defender'
      when 'midfielder' then 'midfielder' when 'forward' then 'forward' end)='goalkeeper'
      and coalesce(ga.attributed,0)=case when roster.session_team_id=m.team_a_id then m.team_b_score else m.team_a_score end
      then coalesce(k.n,0)::integer end keeper_conceded,
    coalesce(match_position.position,case lower(btrim(lineup.position))
      when 'goalkeeper' then 'goalkeeper' when 'defender' then 'defender'
      when 'midfielder' then 'midfielder' when 'forward' then 'forward' end,case lower(btrim(pl.preferred_position))
      when 'goalkeeper' then 'goalkeeper' when 'defender' then 'defender'
      when 'midfielder' then 'midfielder' when 'forward' then 'forward' end)='goalkeeper'
      and (case when roster.session_team_id=m.team_a_id then m.team_b_score else m.team_a_score end)=0 clean_sheet,
    coalesce(ga.attributed,0)<>(case when roster.session_team_id=m.team_a_id then m.team_b_score else m.team_a_score end)
      and coalesce(match_position.position,case lower(btrim(lineup.position))
        when 'goalkeeper' then 'goalkeeper' when 'defender' then 'defender'
        when 'midfielder' then 'midfielder' when 'forward' then 'forward' end,case lower(btrim(pl.preferred_position))
        when 'goalkeeper' then 'goalkeeper' when 'defender' then 'defender'
        when 'midfielder' then 'midfielder' when 'forward' then 'forward' end)='goalkeeper' keeper_attribution_incomplete
  from public.session_matches m
  join public.sessions s on s.id=m.session_id
  join public.session_team_players roster on roster.session_id=s.id
    and roster.session_team_id in(m.team_a_id,m.team_b_id)
  join public.players pl on pl.id=roster.player_id
  left join public.match_player_positions match_position
    on match_position.match_id=m.id and match_position.player_id=roster.player_id
  left join lateral(
    select slot.value->>'position' position
    from public.session_team_lineups lineups
    cross join lateral jsonb_array_elements(coalesce(lineups.positions,'[]'::jsonb)) slot(value)
    where lineups.session_id=s.id and lineups.session_team_id=roster.session_team_id
      and slot.value->>'playerId'=roster.player_id::text
    limit 1
  ) lineup on true
  left join lateral(select sum(goal_count) filter(where conceded_goalkeeper_id is not null) attributed
    from public.goals where match_id=m.id and session_team_id<>roster.session_team_id) ga on true
  left join lateral(select sum(goal_count) filter(where scorer_id=roster.player_id and goal_type='goal') g,
    sum(goal_count) filter(where assist_player_id=roster.player_id and goal_type='goal') a
    from public.goals where match_id=m.id) ind on true
  left join lateral(select sum(goal_count) n from public.goals where match_id=m.id and conceded_goalkeeper_id=roster.player_id) k on true
  where m.result_status='played' and coalesce(match_position.participated,true)
)
select *,public.match_performance_points_v1(position,goals_for,goals_against,goals,assists,keeper_conceded) breakdown from facts;

create or replace function public.performance_season_rows(p_season_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce((select jsonb_agg(to_jsonb(r) order by position,average_session_rating desc,player_name) from (
    select d.player_id,d.player_name,d.position,count(*) matches_played,count(distinct d.session_id) sessions_played,
      round(avg((d.breakdown->>'rating')::numeric),2) average_match_rating,
      (select round(avg(position_session.points),2) from (
        select avg((pm.breakdown->>'rating')::numeric)*4 + least(60,30*(select count(*) from public.valid_performance_votes v
          where v.session_id=pm.session_id and v.player_id=pm.player_id and v.category=pm.position)) points
        from public.match_performance_detail pm where pm.season_id=p_season_id and pm.player_id=d.player_id and pm.position=d.position
        group by pm.session_id,pm.player_id,pm.position
      ) position_session) average_session_rating,
      (select count(*) from public.valid_performance_votes v join public.sessions s on s.id=v.session_id
        where s.season_id=p_season_id and v.player_id=d.player_id and v.category=d.position) nominations
    from public.match_performance_detail d where d.season_id=p_season_id and d.position is not null
    group by d.player_id,d.player_name,d.position
  ) r),'[]'::jsonb);
$$;
revoke all on function public.performance_season_rows(uuid) from public,anon,authenticated;

create or replace function public.season_performance(p_season_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare program uuid;
begin
  select program_id into program from public.seasons where id=p_season_id;
  if not coalesce(public.performance_access(program),false) then raise exception 'Program access required'; end if;
  return public.performance_season_rows(p_season_id);
end;
$$;

create or replace function public.scoped_public_position_leaderboards(
  p_organization_slug text,p_program_slug text,p_season_id uuid
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  if not exists(
    select 1 from public.resolve_enabled_public_scope(p_organization_slug,p_program_slug) scope
    join public.seasons s on s.organization_id=scope.organization_id
      and (scope.program_id is null or s.program_id=scope.program_id)
    where s.id=p_season_id and public.is_program_module_enabled(s.program_id,'public_reports')
  ) then raise exception 'Public performance report is not enabled for this season'; end if;
  with rated as (
    select value,(value->>'position') position,(value->>'average_session_rating')::numeric rating
    from jsonb_array_elements(public.performance_season_rows(p_season_id)) value
  ), ranked as (
    select *,dense_rank() over(partition by position order by rating desc) rank
    from rated where position in('goalkeeper','defender','midfielder') and rating is not null
  )
  select jsonb_build_object(
    'goalkeeper',coalesce((select jsonb_agg(value order by value->>'player_name') from ranked where position='goalkeeper' and rank=1),'[]'::jsonb),
    'defender',coalesce((select jsonb_agg(value order by value->>'player_name') from ranked where position='defender' and rank=1),'[]'::jsonb),
    'midfielder',coalesce((select jsonb_agg(value order by value->>'player_name') from ranked where position='midfielder' and rank=1),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.scoped_public_position_leaderboards(text,text,uuid) from public;
grant execute on function public.scoped_public_position_leaderboards(text,text,uuid) to anon,authenticated;

create or replace function public.session_performance(p_session_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare s public.sessions; answer jsonb;
begin
  select * into s from public.sessions where id=p_session_id;
  if not coalesce(public.performance_access(s.program_id),false) then raise exception 'Program access required'; end if;
  select jsonb_build_object(
    'session',jsonb_build_object('id',s.id,'name',s.name,'status',s.status,'seasonId',s.season_id),
    'canManage',public.program_role(s.program_id) in('manager','captain') and public.is_program_module_enabled(s.program_id,'scores'),
    'canClose',public.program_role(s.program_id)='manager',
    'closed',coalesce((select closed from public.session_performance_voting where session_id=s.id),false),
    'teams',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'canVote',exists(
      select 1 from public.program_members pm where pm.program_id=s.program_id and pm.profile_id=auth.uid()
        and pm.status='active' and pm.player_id=t.captain_player_id),
      'players',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name)),'[]'::jsonb)
        from public.session_team_players tp join public.players p on p.id=tp.player_id where tp.session_team_id=t.id)))
      from public.session_teams t where t.session_id=s.id),'[]'::jsonb),
    'matches',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'number',m.match_number,
      'teamAId',m.team_a_id,'teamBId',m.team_b_id,
      'teamAName',coalesce(team_a.name,case m.team_a_source when 'standings_rank_1' then '1st place' else 'Team A' end),
      'teamBName',coalesce(team_b.name,case m.team_b_source when 'standings_rank_2' then '2nd place' else 'Team B' end),
      'status',m.result_status) order by m.match_number)
      from public.session_matches m
      left join public.session_teams team_a on team_a.id=m.team_a_id
      left join public.session_teams team_b on team_b.id=m.team_b_id
      where m.session_id=s.id),'[]'::jsonb),
    'positions',coalesce((select jsonb_agg(jsonb_build_object(
      'match_id',m.id,'player_id',roster.player_id,'session_team_id',roster.session_team_id,
      'position',coalesce(match_position.position,case lower(btrim(lineup.position))
        when 'goalkeeper' then 'goalkeeper' when 'defender' then 'defender'
        when 'midfielder' then 'midfielder' when 'forward' then 'forward' end,case lower(btrim(p.preferred_position))
        when 'goalkeeper' then 'goalkeeper' when 'defender' then 'defender'
        when 'midfielder' then 'midfielder' when 'forward' then 'forward' end),
      'participated',coalesce(match_position.participated,true)
    ) order by m.match_number,p.display_name)
      from public.session_matches m
      join public.session_team_players roster on roster.session_id=s.id and roster.session_team_id in(m.team_a_id,m.team_b_id)
      join public.players p on p.id=roster.player_id
      left join public.match_player_positions match_position on match_position.match_id=m.id and match_position.player_id=roster.player_id
      left join lateral(
        select slot.value->>'position' position
        from public.session_team_lineups lineups
        cross join lateral jsonb_array_elements(coalesce(lineups.positions,'[]'::jsonb)) slot(value)
        where lineups.session_id=s.id and lineups.session_team_id=roster.session_team_id
          and slot.value->>'playerId'=roster.player_id::text limit 1
      ) lineup on true
      where m.session_id=s.id),'[]'::jsonb),
    'results',coalesce((select jsonb_agg(to_jsonb(r) order by final_rating desc,player_name) from public.session_performance_results r where r.session_id=s.id),'[]'::jsonb),
    'details',coalesce((select jsonb_agg(to_jsonb(d) order by match_number,player_name) from public.match_performance_detail d where d.session_id=s.id),'[]'::jsonb),
    'votes',coalesce((select jsonb_agg(to_jsonb(v)) from public.valid_performance_votes v where v.session_id=s.id),'[]'::jsonb),
    'awards',coalesce((select jsonb_agg(to_jsonb(w)) from (
      select category,player_id,p.display_name player_name,count(*) nominations,
        dense_rank() over(partition by category order by count(*) desc) rank
      from public.valid_performance_votes v join public.players p on p.id=v.player_id
      where v.session_id=s.id group by category,player_id,p.display_name
    ) w where rank=1),'[]'::jsonb)
  ) into answer;
  return answer;
end;
$$;

create or replace function public.save_website_game_scores(p_session_id uuid,p_games jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  program uuid;
  game jsonb;
  player_position jsonb;
  v_match_id uuid;
  v_match_team_a uuid;
  v_match_team_b uuid;
  v_team_a uuid;
  v_team_b uuid;
  v_player uuid;
  v_team uuid;
  v_position text;
  v_participated boolean;
begin
  select program_id into program from public.sessions where id=p_session_id;
  if auth.uid() is null or public.program_role(program) not in('manager','captain') then raise exception 'Unauthorized'; end if;
  if not public.is_program_module_enabled(program,'scores') then raise exception 'Scores are disabled for this program'; end if;
  if jsonb_typeof(p_games) is distinct from 'array' then raise exception 'Game score data is invalid'; end if;
  perform set_config('app.authorized_program_id',program::text,true);

  for game in select value from jsonb_array_elements(p_games)
  loop
    if jsonb_typeof(game->'positions') is distinct from 'array'
      or coalesce(game->>'matchNumber','') !~ '^[0-9]+$' then continue; end if;
    select m.id,m.team_a_id,m.team_b_id into v_match_id,v_match_team_a,v_match_team_b
      from public.session_matches m where m.session_id=p_session_id
        and m.match_number=(game->>'matchNumber')::integer;
    if v_match_id is null then continue; end if;
    v_team_a:=case when coalesce(game->>'teamAId','') ~* '^[0-9a-f-]{36}$' then (game->>'teamAId')::uuid else v_match_team_a end;
    v_team_b:=case when coalesce(game->>'teamBId','') ~* '^[0-9a-f-]{36}$' then (game->>'teamBId')::uuid else v_match_team_b end;
    if not exists(select 1 from public.session_teams where id=v_team_a and session_id=p_session_id)
      or not exists(select 1 from public.session_teams where id=v_team_b and session_id=p_session_id) then continue; end if;

    for player_position in select value from jsonb_array_elements(game->'positions')
    loop
      if coalesce(player_position->>'playerId','') !~* '^[0-9a-f-]{36}$' then continue; end if;
      v_player:=(player_position->>'playerId')::uuid;
      v_position:=nullif(lower(btrim(player_position->>'position')),'');
      if v_position is not null and v_position not in('goalkeeper','defender','midfielder','forward')
        then raise exception 'Invalid match position'; end if;
      v_participated:=coalesce((player_position->>'participated')::boolean,true);
      select session_team_id into v_team from public.session_team_players
        where session_id=p_session_id and player_id=v_player;
      if v_team is null or v_team not in(v_team_a,v_team_b) then raise exception 'Player is not on a participating team'; end if;
      if exists(select 1 from public.goals where goals.match_id=v_match_id and goals.conceded_goalkeeper_id=v_player)
        and (v_position is distinct from 'goalkeeper' or not v_participated) then
        raise exception 'Correct goalkeeper assignments on goals before changing this position';
      end if;
      insert into public.match_player_positions(match_id,player_id,session_team_id,position,participated,confirmed_by)
        values(v_match_id,v_player,v_team,v_position,v_participated,auth.uid())
        on conflict(match_id,player_id) do update set session_team_id=excluded.session_team_id,
          position=excluded.position,participated=excluded.participated,confirmed_by=auth.uid(),updated_at=now();
    end loop;
  end loop;

  return public.save_program_game_scores(p_session_id,p_games);
end;
$$;
revoke all on function public.save_website_game_scores(uuid,jsonb) from public,anon;
grant execute on function public.save_website_game_scores(uuid,jsonb) to authenticated;

-- Reconciled source: 100_match_position_priority.sql
create table if not exists public.match_score_positions (
  match_id uuid not null references public.session_matches(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  position text check(position in ('goalkeeper','defender','midfielder','forward')),
  updated_at timestamptz not null default now(),
  primary key(match_id,player_id)
);

alter table public.match_score_positions enable row level security;
revoke all on public.match_score_positions from public,anon,authenticated;

-- Preserve legacy score-copy rows that migration 100 intentionally removes as non-authoritative.
INSERT INTO public.match_player_positions_legacy_archive (
  match_id, player_id, session_team_id, position, participated,
  confirmed_by, updated_at, archive_reason
)
SELECT mp.match_id, mp.player_id, mp.session_team_id, mp.position, mp.participated,
  mp.confirmed_by, mp.updated_at, 'No matching audited match-position override'
FROM public.match_player_positions mp
WHERE NOT EXISTS (
  SELECT 1
  FROM public.session_matches match
  JOIN public.performance_changes changes ON changes.session_id = match.session_id
    AND changes.action = 'positions' AND changes.details->>'matchId' = mp.match_id::text
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(changes.details->'players') = 'array'
      THEN changes.details->'players' ELSE '[]'::jsonb END
  ) entry(value)
  WHERE match.id = mp.match_id AND entry.value->>'playerId' = mp.player_id::text
)
ON CONFLICT (match_id, player_id) DO NOTHING;

with audited_positions as (
  select distinct on (mp.match_id,mp.player_id)
    mp.match_id,mp.player_id,changes.actor_id,changes.created_at,entry.value
  from public.match_player_positions mp
  join public.session_matches match on match.id=mp.match_id
  join public.performance_changes changes on changes.session_id=match.session_id
    and changes.action='positions' and changes.details->>'matchId'=mp.match_id::text
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(changes.details->'players')='array'
      then changes.details->'players' else '[]'::jsonb end
  ) entry(value)
  where entry.value->>'playerId'=mp.player_id::text
  order by mp.match_id,mp.player_id,changes.created_at desc,changes.id desc
)
update public.match_player_positions mp
set position=nullif(audited.value->>'position',''),
  participated=coalesce((audited.value->>'participated')::boolean,true),
  confirmed_by=audited.actor_id,
  updated_at=audited.created_at
from audited_positions audited
where audited.match_id=mp.match_id and audited.player_id=mp.player_id;

-- Legacy score saves copied fallback positions without recording their source.
-- Only audited performance overrides are authoritative enough to retain.
delete from public.match_player_positions mp
where not exists (
  select 1
  from public.session_matches match
  join public.performance_changes changes on changes.session_id=match.session_id
    and changes.action='positions' and changes.details->>'matchId'=mp.match_id::text
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(changes.details->'players')='array'
      then changes.details->'players' else '[]'::jsonb end
  ) entry(value)
  where match.id=mp.match_id and entry.value->>'playerId'=mp.player_id::text
);

create or replace function public.resolved_match_player_position(p_match_id uuid,p_player_id uuid)
returns text language sql stable security definer set search_path=public as $$
  select coalesce(
    (select confirmed.position from public.match_player_positions confirmed
      where confirmed.match_id=p_match_id and confirmed.player_id=p_player_id),
    (select scored.position from public.match_score_positions scored
      where scored.match_id=p_match_id and scored.player_id=p_player_id),
    (select case lower(btrim(slot.value->>'position'))
        when 'goalkeeper' then 'goalkeeper' when 'defender' then 'defender'
        when 'midfielder' then 'midfielder' when 'forward' then 'forward' end
      from public.session_matches match
      join public.session_team_players roster on roster.session_id=match.session_id
      cross join lateral (
        select lineup.positions
        from public.session_team_lineups lineup
        where lineup.session_id=match.session_id
          and lineup.session_team_id=roster.session_team_id
        order by lineup.updated_at desc,lineup.id
        limit 1
      ) lineups
      cross join lateral jsonb_array_elements(coalesce(lineups.positions,'[]'::jsonb)) slot(value)
      where match.id=p_match_id and roster.player_id=p_player_id
        and slot.value->>'playerId'=p_player_id::text
      limit 1),
    (select case lower(btrim(player.preferred_position))
        when 'goalkeeper' then 'goalkeeper' when 'defender' then 'defender'
        when 'midfielder' then 'midfielder' when 'forward' then 'forward' end
      from public.players player where player.id=p_player_id)
  );
$$;
revoke all on function public.resolved_match_player_position(uuid,uuid) from public,anon,authenticated;

create or replace function public.validate_conceded_goalkeeper() returns trigger
language plpgsql set search_path=public as $$
begin
  if new.conceded_goalkeeper_id is not null and not exists (
    select 1
    from public.session_matches match
    join public.session_team_players roster on roster.session_id=match.session_id
      and roster.player_id=new.conceded_goalkeeper_id
      and ((new.session_team_id=match.team_a_id and roster.session_team_id=match.team_b_id)
        or (new.session_team_id=match.team_b_id and roster.session_team_id=match.team_a_id))
    where match.id=new.match_id
      and not exists (
        select 1 from public.match_player_positions participation
        where participation.match_id=match.id
          and participation.player_id=roster.player_id
          and not participation.participated
      )
      and (
        current_setting('app.allow_manual_goalkeeper',true)='true'
        or exists (
          select 1 from public.match_player_positions confirmed_goalkeeper
          where confirmed_goalkeeper.match_id=match.id
            and confirmed_goalkeeper.player_id=roster.player_id
            and confirmed_goalkeeper.position='goalkeeper'
            and confirmed_goalkeeper.participated
        )
      )
  ) then raise exception 'Select a confirmed opposing goalkeeper for this match'; end if;
  return new;
end;
$$;

create or replace view public.match_performance_detail as
with facts as (
  select s.id session_id,s.season_id,s.program_id,m.id match_id,m.match_number,
    roster.player_id,pl.display_name player_name,roster.session_team_id,
    resolved.position,
    case when roster.session_team_id=m.team_a_id then m.team_a_score else m.team_b_score end goals_for,
    case when roster.session_team_id=m.team_a_id then m.team_b_score else m.team_a_score end goals_against,
    coalesce(ind.g,0)::integer goals,coalesce(ind.a,0)::integer assists,
    case when resolved.position='goalkeeper'
      and coalesce(ga.attributed,0)=case when roster.session_team_id=m.team_a_id then m.team_b_score else m.team_a_score end
      then coalesce(k.n,0)::integer end keeper_conceded,
    resolved.position='goalkeeper'
      and (case when roster.session_team_id=m.team_a_id then m.team_b_score else m.team_a_score end)=0 clean_sheet,
    coalesce(ga.attributed,0)<>(case when roster.session_team_id=m.team_a_id then m.team_b_score else m.team_a_score end)
      and resolved.position='goalkeeper' keeper_attribution_incomplete
  from public.session_matches m
  join public.sessions s on s.id=m.session_id
  join public.session_team_players roster on roster.session_id=s.id
    and roster.session_team_id in(m.team_a_id,m.team_b_id)
  join public.players pl on pl.id=roster.player_id
  left join public.match_player_positions match_position
    on match_position.match_id=m.id and match_position.player_id=roster.player_id
  cross join lateral (select public.resolved_match_player_position(m.id,roster.player_id) position) resolved
  left join lateral(select sum(goal_count) filter(where conceded_goalkeeper_id is not null) attributed
    from public.goals where match_id=m.id and session_team_id<>roster.session_team_id) ga on true
  left join lateral(select sum(goal_count) filter(where scorer_id=roster.player_id and goal_type='goal') g,
    sum(goal_count) filter(where assist_player_id=roster.player_id and goal_type='goal') a
    from public.goals where match_id=m.id) ind on true
  left join lateral(select sum(goal_count) n from public.goals
    where match_id=m.id and conceded_goalkeeper_id=roster.player_id) k on true
  where m.result_status='played' and coalesce(match_position.participated,true)
)
select *,public.match_performance_points_v1(position,goals_for,goals_against,goals,assists,keeper_conceded) breakdown from facts;

create or replace function public.session_performance(p_session_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare s public.sessions; answer jsonb;
begin
  select * into s from public.sessions where id=p_session_id;
  if not coalesce(public.performance_access(s.program_id),false) then raise exception 'Program access required'; end if;
  select jsonb_build_object(
    'session',jsonb_build_object('id',s.id,'name',s.name,'status',s.status,'seasonId',s.season_id),
    'canManage',public.program_role(s.program_id) in('manager','captain') and public.is_program_module_enabled(s.program_id,'scores'),
    'canClose',public.program_role(s.program_id)='manager',
    'closed',coalesce((select closed from public.session_performance_voting where session_id=s.id),false),
    'teams',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'canVote',exists(
      select 1 from public.program_members pm where pm.program_id=s.program_id and pm.profile_id=auth.uid()
        and pm.status='active' and pm.player_id=t.captain_player_id),
      'players',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name)),'[]'::jsonb)
        from public.session_team_players tp join public.players p on p.id=tp.player_id where tp.session_team_id=t.id)))
      from public.session_teams t where t.session_id=s.id),'[]'::jsonb),
    'matches',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'number',m.match_number,
      'teamAId',m.team_a_id,'teamBId',m.team_b_id,
      'teamAName',coalesce(team_a.name,case m.team_a_source when 'standings_rank_1' then '1st place' else 'Team A' end),
      'teamBName',coalesce(team_b.name,case m.team_b_source when 'standings_rank_2' then '2nd place' else 'Team B' end),
      'status',m.result_status) order by m.match_number)
      from public.session_matches m
      left join public.session_teams team_a on team_a.id=m.team_a_id
      left join public.session_teams team_b on team_b.id=m.team_b_id
      where m.session_id=s.id),'[]'::jsonb),
    'positions',coalesce((select jsonb_agg(jsonb_build_object(
      'match_id',m.id,'player_id',roster.player_id,'session_team_id',roster.session_team_id,
      'position',public.resolved_match_player_position(m.id,roster.player_id),
      'confirmed_position',match_position.position,
      'score_position',score_position.position,
      'participated',coalesce(match_position.participated,true)
    ) order by m.match_number,p.display_name,p.id)
      from public.session_matches m
      join public.session_team_players roster on roster.session_id=s.id and roster.session_team_id in(m.team_a_id,m.team_b_id)
      join public.players p on p.id=roster.player_id
      left join public.match_player_positions match_position on match_position.match_id=m.id and match_position.player_id=roster.player_id
      left join public.match_score_positions score_position on score_position.match_id=m.id and score_position.player_id=roster.player_id
      where m.session_id=s.id),'[]'::jsonb),
    'results',coalesce((select jsonb_agg(to_jsonb(r) order by final_rating desc,player_name) from public.session_performance_results r where r.session_id=s.id),'[]'::jsonb),
    'details',coalesce((select jsonb_agg(to_jsonb(d) order by match_number,player_name) from public.match_performance_detail d where d.session_id=s.id),'[]'::jsonb),
    'votes',coalesce((select jsonb_agg(to_jsonb(v)) from public.valid_performance_votes v where v.session_id=s.id),'[]'::jsonb),
    'awards',coalesce((select jsonb_agg(to_jsonb(w)) from (
      select category,player_id,p.display_name player_name,count(*) nominations,
        dense_rank() over(partition by category order by count(*) desc) rank
      from public.valid_performance_votes v join public.players p on p.id=v.player_id
      where v.session_id=s.id group by category,player_id,p.display_name
    ) w where rank=1),'[]'::jsonb)
  ) into answer;
  return answer;
end;
$$;

create or replace function public.save_website_game_scores(p_session_id uuid,p_games jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  program uuid;
  game jsonb;
  player_position jsonb;
  v_match_id uuid;
  v_match_team_a uuid;
  v_match_team_b uuid;
  v_team_a uuid;
  v_team_b uuid;
  v_player uuid;
  v_team uuid;
  v_position text;
begin
  select program_id into program from public.sessions where id=p_session_id;
  if auth.uid() is null or public.program_role(program) not in('manager','captain') then raise exception 'Unauthorized'; end if;
  if not public.is_program_module_enabled(program,'scores') then raise exception 'Scores are disabled for this program'; end if;
  if jsonb_typeof(p_games) is distinct from 'array' then raise exception 'Game score data is invalid'; end if;
  perform set_config('app.authorized_program_id',program::text,true);
  perform set_config('app.allow_manual_goalkeeper','true',true);

  for game in select value from jsonb_array_elements(p_games)
  loop
    if jsonb_typeof(game->'positions') is distinct from 'array'
      or coalesce(game->>'matchNumber','') !~ '^[0-9]+$' then continue; end if;
    v_match_id:=null;
    select m.id,m.team_a_id,m.team_b_id into v_match_id,v_match_team_a,v_match_team_b
      from public.session_matches m where m.session_id=p_session_id
        and m.match_number=(game->>'matchNumber')::integer;
    if v_match_id is null then continue; end if;
    v_team_a:=case when coalesce(game->>'teamAId','') ~* '^[0-9a-f-]{36}$' then (game->>'teamAId')::uuid else v_match_team_a end;
    v_team_b:=case when coalesce(game->>'teamBId','') ~* '^[0-9a-f-]{36}$' then (game->>'teamBId')::uuid else v_match_team_b end;
    if not exists(select 1 from public.session_teams where id=v_team_a and session_id=p_session_id)
      or not exists(select 1 from public.session_teams where id=v_team_b and session_id=p_session_id)
      or v_team_a=v_team_b then continue; end if;

    delete from public.match_score_positions where match_id=v_match_id;
    for player_position in select value from jsonb_array_elements(game->'positions')
    loop
      if coalesce(player_position->>'playerId','') !~* '^[0-9a-f-]{36}$' then continue; end if;
      v_player:=(player_position->>'playerId')::uuid;
      v_position:=nullif(lower(btrim(player_position->>'position')),'');
      if v_position is not null and v_position not in('goalkeeper','defender','midfielder','forward')
        then raise exception 'Invalid match position'; end if;
      select session_team_id into v_team from public.session_team_players
        where session_id=p_session_id and player_id=v_player;
      if v_team is null or v_team not in(v_team_a,v_team_b) then raise exception 'Player is not on a participating team'; end if;
      if v_position is not null then
        insert into public.match_score_positions(match_id,player_id,position)
          values(v_match_id,v_player,v_position)
          on conflict(match_id,player_id) do update set position=excluded.position,updated_at=now();
      end if;
    end loop;
  end loop;

  return public.save_program_game_scores(p_session_id,p_games);
end;
$$;
revoke all on function public.save_website_game_scores(uuid,jsonb) from public,anon;
grant execute on function public.save_website_game_scores(uuid,jsonb) to authenticated;

-- Reconciled source: 101_session_player_nominations.sql
create table if not exists public.session_performance_nominator_authorizations (
  session_id uuid not null references public.sessions(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  authorized_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key(session_id,player_id)
);

create table if not exists public.session_performance_nominations (
  session_id uuid not null references public.sessions(id) on delete cascade,
  voter_id uuid not null references public.profiles(id),
  voter_player_id uuid not null references public.players(id),
  category text not null check(category in ('goalkeeper','defender','midfielder')),
  player_id uuid not null references public.players(id),
  created_at timestamptz not null default now(),
  primary key(session_id,voter_player_id,category),
  check(voter_player_id<>player_id)
);
create index if not exists session_performance_nominations_category_player_idx
  on public.session_performance_nominations(session_id,category,player_id);

alter table public.session_performance_nominator_authorizations enable row level security;
alter table public.session_performance_nominations enable row level security;
revoke all on public.session_performance_nominator_authorizations,public.session_performance_nominations from public,anon,authenticated;

create or replace view public.valid_session_performance_nominations as
select nomination.session_id,nomination.voter_id,nomination.voter_player_id,
  nomination.category,nomination.player_id,nomination.created_at
from public.session_performance_nominations nomination
join public.sessions session on session.id=nomination.session_id and session.status='completed'
join public.program_members member on member.program_id=session.program_id
  and member.profile_id=nomination.voter_id and member.player_id=nomination.voter_player_id
  and member.status='active'
where (
  exists(select 1 from public.session_team_players participant
    where participant.session_id=session.id and participant.player_id=nomination.voter_player_id)
  or exists(select 1 from public.session_performance_nominator_authorizations authz
    where authz.session_id=session.id and authz.player_id=nomination.voter_player_id)
)
and exists(select 1 from public.match_performance_detail eligible
  where eligible.session_id=session.id and eligible.player_id=nomination.player_id
    and eligible.position=nomination.category)
and nomination.voter_player_id<>nomination.player_id;

create or replace view public.valid_performance_votes as
select legacy.session_id,legacy.captain_team_id,legacy.category,legacy.player_id,legacy.voter_id,legacy.updated_at
from public.captain_performance_votes legacy
join public.sessions session on session.id=legacy.session_id and session.status='completed'
join public.session_teams captain on captain.id=legacy.captain_team_id and captain.session_id=session.id
where exists(select 1 from public.program_members member where member.program_id=session.program_id
  and member.profile_id=legacy.voter_id and member.status='active' and member.player_id=captain.captain_player_id)
and exists(select 1 from public.match_performance_detail detail
  where detail.session_id=session.id and detail.player_id=legacy.player_id and detail.position=legacy.category)
and not exists(select 1 from public.session_team_players own
  where own.session_id=session.id and own.session_team_id=captain.id and own.player_id=legacy.player_id)
and not exists(select 1 from public.valid_session_performance_nominations nomination
  where nomination.session_id=legacy.session_id and nomination.voter_id=legacy.voter_id
    and nomination.category=legacy.category)
union all
select nomination.session_id,null::uuid,nomination.category,nomination.player_id,
  nomination.voter_id,nomination.created_at
from public.valid_session_performance_nominations nomination;

create or replace view public.session_category_nomination_points as
with vote_counts as (
  select session_id,category,count(*)::numeric total_votes
  from public.valid_performance_votes
  group by session_id,category
), received as (
  select session_id,category,player_id,count(*)::numeric votes_received
  from public.valid_performance_votes
  group by session_id,category,player_id
)
select received.session_id,received.category,received.player_id,
  received.votes_received,
  least(20::numeric,60::numeric/vote_counts.total_votes) points_per_vote,
  least(60::numeric,received.votes_received*least(20::numeric,60::numeric/vote_counts.total_votes)) nomination_points
from received join vote_counts using(session_id,category);

create or replace view public.session_player_nomination_points as
select session_id,player_id,least(60::numeric,sum(nomination_points)) nomination_points
from public.session_category_nomination_points
group by session_id,player_id;

create or replace view public.session_performance_results as
select detail.session_id,detail.season_id,detail.program_id,detail.player_id,detail.player_name,
  count(*)::integer matches_played,
  count(*) filter(where detail.position is not null)::integer rated_matches,
  array_agg(distinct detail.position) filter(where detail.position is not null) positions,
  round(sum(coalesce((detail.breakdown->>'rating')::numeric,0))*4/count(*),2) match_points,
  round(coalesce(nomination.nomination_points,0))::integer captain_points,
  round(sum(coalesce((detail.breakdown->>'rating')::numeric,0))*4/count(*)
    +coalesce(nomination.nomination_points,0),2) final_rating,
  sum(detail.goals)::integer goals,sum(detail.assists)::integer assists,
  count(*) filter(where detail.clean_sheet)::integer clean_sheets,
  sum(detail.keeper_conceded)::integer keeper_conceded,
  bool_or(detail.position is null or detail.keeper_attribution_incomplete) incomplete,
  coalesce(nomination.nomination_points,0)::numeric nomination_points
from public.match_performance_detail detail
left join public.session_player_nomination_points nomination
  on nomination.session_id=detail.session_id and nomination.player_id=detail.player_id
group by detail.session_id,detail.season_id,detail.program_id,detail.player_id,detail.player_name,
  nomination.nomination_points;

create or replace function public.performance_season_rows(p_season_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce((select jsonb_agg(to_jsonb(r) order by position,average_session_rating desc,player_name) from (
    select detail.player_id,detail.player_name,detail.position,count(*) matches_played,
      count(distinct detail.session_id) sessions_played,
      round(avg((detail.breakdown->>'rating')::numeric),2) average_match_rating,
      (select round(avg(session_rating.points),2) from (
        select avg((match_detail.breakdown->>'rating')::numeric)*4
          +coalesce(category_points.nomination_points,0) points
        from public.match_performance_detail match_detail
        left join public.session_category_nomination_points category_points
          on category_points.session_id=match_detail.session_id
          and category_points.player_id=match_detail.player_id
          and category_points.category=match_detail.position
        where match_detail.season_id=p_season_id and match_detail.player_id=detail.player_id
          and match_detail.position=detail.position
        group by match_detail.session_id,match_detail.player_id,match_detail.position,
          category_points.nomination_points
      ) session_rating) average_session_rating,
      (select count(*) from public.valid_performance_votes vote
        join public.sessions session on session.id=vote.session_id
        where session.season_id=p_season_id and vote.player_id=detail.player_id
          and vote.category=detail.position) nominations
    from public.match_performance_detail detail
    where detail.season_id=p_season_id and detail.position is not null
    group by detail.player_id,detail.player_name,detail.position
  ) r),'[]'::jsonb);
$$;

create or replace function public.submit_session_performance_nomination(
  p_session_id uuid,p_category text,p_player_id uuid
) returns void language plpgsql security definer set search_path=public as $$
declare session public.sessions; voter_player uuid;
begin
  select * into session from public.sessions where id=p_session_id for update;
  if not coalesce(public.performance_access(session.program_id),false) then
    raise exception 'Program access required';
  end if;
  if session.status<>'completed' then raise exception 'Nominations open after session completion'; end if;
  if exists(select 1 from public.session_performance_voting where session_id=session.id and closed) then
    raise exception 'Nominations are closed';
  end if;
  if p_category is null or p_category not in('goalkeeper','defender','midfielder') then
    raise exception 'Select Top Goalkeeper, Top Defender, or Top Midfielder';
  end if;
  select member.player_id into voter_player
  from public.program_members member
  where member.program_id=session.program_id and member.profile_id=auth.uid()
    and member.status='active' and member.player_id is not null;
  if voter_player is null then raise exception 'Link your account to a player profile to nominate'; end if;
  if not exists(select 1 from public.session_team_players participant
      where participant.session_id=session.id and participant.player_id=voter_player)
    and not exists(select 1 from public.session_performance_nominator_authorizations authz
      where authz.session_id=session.id and authz.player_id=voter_player) then
    raise exception 'You are not authorized to nominate for this session';
  end if;
  if p_player_id=voter_player then raise exception 'You cannot nominate yourself'; end if;
  if not exists(select 1 from public.match_performance_detail eligible
      where eligible.session_id=session.id and eligible.player_id=p_player_id
        and eligible.position=p_category) then
    raise exception 'The nominee must have participated at the selected position';
  end if;
  if exists(select 1 from public.valid_session_performance_nominations nomination
      where nomination.session_id=session.id and nomination.voter_player_id=voter_player
        and nomination.category=p_category) then
    raise exception 'You have already nominated in this category';
  end if;
  insert into public.session_performance_nominations(
    session_id,voter_id,voter_player_id,category,player_id
  ) values(session.id,auth.uid(),voter_player,p_category,p_player_id)
  on conflict(session_id,voter_player_id,category) do update
    set voter_id=excluded.voter_id,player_id=excluded.player_id,created_at=now();
  insert into public.performance_changes(session_id,actor_id,action,details)
  values(session.id,auth.uid(),'player_nomination',jsonb_build_object(
    'voterPlayerId',voter_player,'category',p_category,'playerId',p_player_id
  ));
end;
$$;

create or replace function public.authorize_session_performance_nominator(
  p_session_id uuid,p_player_id uuid,p_authorized boolean
) returns void language plpgsql security definer set search_path=public as $$
declare session public.sessions;
begin
  select * into session from public.sessions where id=p_session_id for update;
  if not coalesce(public.performance_access(session.program_id)
      and public.program_role(session.program_id)='manager',false) then
    raise exception 'Manager access required';
  end if;
  if exists(select 1 from public.session_performance_voting where session_id=session.id and closed) then
    raise exception 'Nominations are closed';
  end if;
  if p_authorized is null then raise exception 'Authorization choice is required'; end if;
  if not exists(select 1 from public.program_members member
      where member.program_id=session.program_id and member.player_id=p_player_id
        and member.status='active') then
    raise exception 'Select an active program player';
  end if;
  if p_authorized and exists(select 1 from public.session_team_players participant
      where participant.session_id=session.id and participant.player_id=p_player_id) then
    raise exception 'Session participants are already eligible to nominate';
  end if;
  if p_authorized then
    insert into public.session_performance_nominator_authorizations(session_id,player_id,authorized_by)
    values(session.id,p_player_id,auth.uid())
    on conflict(session_id,player_id) do update set authorized_by=excluded.authorized_by,created_at=now();
  else
    delete from public.session_performance_nominator_authorizations
    where session_id=session.id and player_id=p_player_id;
  end if;
  insert into public.performance_changes(session_id,actor_id,action,details)
  values(session.id,auth.uid(),'nominator_authorization',jsonb_build_object(
    'playerId',p_player_id,'authorized',p_authorized
  ));
end;
$$;

create or replace function public.session_performance(p_session_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare session public.sessions; answer jsonb; current_voter uuid;
begin
  select * into session from public.sessions where id=p_session_id;
  if not coalesce(public.performance_access(session.program_id),false) then
    raise exception 'Program access required';
  end if;
  select member.player_id into current_voter from public.program_members member
  where member.program_id=session.program_id and member.profile_id=auth.uid()
    and member.status='active' and member.player_id is not null;
  select jsonb_build_object(
    'session',jsonb_build_object('id',session.id,'name',session.name,'status',session.status,'seasonId',session.season_id),
    'canManage',public.program_role(session.program_id) in('manager','captain')
      and public.is_program_module_enabled(session.program_id,'scores'),
    'canClose',public.program_role(session.program_id)='manager',
    'canAuthorizeVoters',public.program_role(session.program_id)='manager',
    'canNominate',current_voter is not null and session.status='completed'
      and not coalesce((select closed from public.session_performance_voting where session_id=session.id),false)
      and (exists(select 1 from public.session_team_players participant
          where participant.session_id=session.id and participant.player_id=current_voter)
        or exists(select 1 from public.session_performance_nominator_authorizations authz
          where authz.session_id=session.id and authz.player_id=current_voter)),
    'voterPlayerId',current_voter,
    'closed',coalesce((select closed from public.session_performance_voting where session_id=session.id),false),
    'teams',coalesce((select jsonb_agg(jsonb_build_object(
      'id',team.id,'name',team.name,
      'canVote',exists(select 1 from public.program_members member
        where member.program_id=session.program_id and member.profile_id=auth.uid()
          and member.status='active' and member.player_id=team.captain_player_id),
      'players',(select coalesce(jsonb_agg(jsonb_build_object('id',player.id,'name',player.display_name)),
          '[]'::jsonb)
        from public.session_team_players roster join public.players player on player.id=roster.player_id
        where roster.session_team_id=team.id)
    ) order by team.name) from public.session_teams team where team.session_id=session.id),'[]'::jsonb),
    'voters',coalesce((select jsonb_agg(jsonb_build_object(
      'playerId',player.id,'name',player.display_name,
      'participated',exists(select 1 from public.session_team_players roster
        where roster.session_id=session.id and roster.player_id=player.id),
      'authorized',exists(select 1 from public.session_performance_nominator_authorizations authz
        where authz.session_id=session.id and authz.player_id=player.id)
    ) order by player.display_name,player.id)
      from public.program_members member join public.players player on player.id=member.player_id
      where member.program_id=session.program_id and member.status='active'
        and member.player_id is not null and public.program_role(session.program_id)='manager'),'[]'::jsonb),
    'matches',coalesce((select jsonb_agg(jsonb_build_object(
      'id',match.id,'number',match.match_number,'teamAId',match.team_a_id,'teamBId',match.team_b_id,
      'teamAName',coalesce(team_a.name,case match.team_a_source when 'standings_rank_1' then '1st place' else 'Team A' end),
      'teamBName',coalesce(team_b.name,case match.team_b_source when 'standings_rank_2' then '2nd place' else 'Team B' end),
      'status',match.result_status) order by match.match_number)
      from public.session_matches match
      left join public.session_teams team_a on team_a.id=match.team_a_id
      left join public.session_teams team_b on team_b.id=match.team_b_id
      where match.session_id=session.id),'[]'::jsonb),
    'positions',coalesce((select jsonb_agg(jsonb_build_object(
      'match_id',match.id,'player_id',roster.player_id,'session_team_id',roster.session_team_id,
      'position',public.resolved_match_player_position(match.id,roster.player_id),
      'confirmed_position',match_position.position,'score_position',score_position.position,
      'goalkeeper_assigned',exists(select 1 from public.goals goal
        where goal.match_id=match.id and goal.conceded_goalkeeper_id=roster.player_id),
      'participated',coalesce(match_position.participated,true)
    ) order by match.match_number,player.display_name,player.id)
      from public.session_matches match
      join public.session_team_players roster on roster.session_id=session.id
        and roster.session_team_id in(match.team_a_id,match.team_b_id)
      join public.players player on player.id=roster.player_id
      left join public.match_player_positions match_position
        on match_position.match_id=match.id and match_position.player_id=roster.player_id
      left join public.match_score_positions score_position
        on score_position.match_id=match.id and score_position.player_id=roster.player_id
      where match.session_id=session.id),'[]'::jsonb),
    'results',coalesce((select jsonb_agg(to_jsonb(result) order by final_rating desc,player_name)
      from public.session_performance_results result where result.session_id=session.id),'[]'::jsonb),
    'details',coalesce((select jsonb_agg(to_jsonb(detail) order by match_number,player_name)
      from public.match_performance_detail detail where detail.session_id=session.id),'[]'::jsonb),
    'votes',coalesce((select jsonb_agg(to_jsonb(vote)) from public.valid_performance_votes vote
      where vote.session_id=session.id),'[]'::jsonb),
    'nominations',coalesce((select jsonb_agg(jsonb_build_object('category',nomination.category,
        'player_id',nomination.player_id))
      from public.valid_session_performance_nominations nomination
      where nomination.session_id=session.id and nomination.voter_id=auth.uid()),'[]'::jsonb),
    'voteCounts',coalesce((select jsonb_agg(jsonb_build_object(
        'category',counts.category,'total',counts.total_votes,'pointsPerVote',counts.points_per_vote))
      from (select category,total_votes,least(20::numeric,60::numeric/total_votes) points_per_vote
        from (select category,count(*)::numeric total_votes from public.valid_performance_votes
          where session_id=session.id group by category) grouped) counts),'[]'::jsonb),
    'awards',coalesce((select jsonb_agg(to_jsonb(winner) order by category,player_name) from (
      select category,player_id,player.display_name player_name,count(*) nominations,
        dense_rank() over(partition by category order by count(*) desc) rank
      from public.valid_performance_votes vote join public.players player on player.id=vote.player_id
      where vote.session_id=session.id group by category,player_id,player.display_name
    ) winner where rank=1),'[]'::jsonb)
  ) into answer;
  return answer;
end;
$$;

create or replace function public.season_performance(p_season_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare program uuid;
begin
  select program_id into program from public.seasons where id=p_season_id;
  if not coalesce(public.performance_access(program),false) then raise exception 'Program access required'; end if;
  return public.performance_season_rows(p_season_id);
end;
$$;

revoke all on public.valid_session_performance_nominations,public.session_category_nomination_points,
  public.session_player_nomination_points from public,anon,authenticated;
revoke all on function public.submit_session_performance_nomination(uuid,text,uuid),
  public.authorize_session_performance_nominator(uuid,uuid,boolean) from public,anon;
grant execute on function public.submit_session_performance_nomination(uuid,text,uuid),
  public.authorize_session_performance_nominator(uuid,uuid,boolean) to authenticated;

-- Reconciled source: 102_scoped_public_session_performance.sql
create or replace function public.scoped_public_session_performance(
  p_organization_slug text,
  p_program_slug text,
  p_session_id uuid
) returns table(
  player_id uuid,
  player_name text,
  positions text[],
  final_rating numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select result.player_id, result.player_name, result.positions, result.final_rating
  from public.resolve_enabled_public_scope(p_organization_slug, p_program_slug) scope
  join public.sessions session
    on session.organization_id = scope.organization_id
   and (scope.program_id is null or session.program_id = scope.program_id)
   and session.id = p_session_id
  join public.session_performance_results result on result.session_id = session.id
  where public.is_program_module_enabled(session.program_id, 'public_reports')
  order by result.final_rating desc, result.player_name, result.player_id;
$$;

revoke all on function public.scoped_public_session_performance(text, text, uuid) from public;
grant execute on function public.scoped_public_session_performance(text, text, uuid) to anon, authenticated;
