-- Confirmed match participation is separate from team membership and draft skill ratings.
create table public.match_player_positions (
  match_id uuid not null references public.session_matches(id) on delete cascade,
  player_id uuid not null references public.players(id),
  session_team_id uuid not null references public.session_teams(id) on delete cascade,
  position text check (position in ('goalkeeper','defender','midfielder','forward')),
  participated boolean not null default true,
  confirmed_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key(match_id,player_id)
);
create index on public.match_player_positions(player_id,match_id);
create table public.session_performance_voting (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  closed boolean not null default false,
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now()
);
create table public.captain_performance_votes (
  session_id uuid not null references public.sessions(id) on delete cascade,
  captain_team_id uuid not null references public.session_teams(id) on delete cascade,
  category text not null check(category in ('goalkeeper','defender','midfielder')),
  player_id uuid not null references public.players(id),
  voter_id uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key(session_id,captain_team_id,category)
);
create table public.performance_changes (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.sessions(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  action text not null,
  details jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.goals add column conceded_goalkeeper_id uuid references public.players(id);
create index on public.goals(conceded_goalkeeper_id) where conceded_goalkeeper_id is not null;
alter table public.match_player_positions enable row level security;
alter table public.session_performance_voting enable row level security;
alter table public.captain_performance_votes enable row level security;
alter table public.performance_changes enable row level security;

create function public.performance_access(p_program uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select auth.uid() is not null and (public.mobile_program_access(p_program)
    or coalesce(public.program_role(p_program)='manager',false));
$$;
create policy performance_position_read on public.match_player_positions for select to authenticated
  using(exists(select 1 from public.session_matches m join public.sessions s on s.id=m.session_id
    where m.id=match_id and public.performance_access(s.program_id)));

-- Versioned, numeric-only scoring. Unknown positions deliberately have no rating.
create function public.match_performance_points_v1(p_position text,p_for integer,p_against integer,
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

create function public.validate_conceded_goalkeeper() returns trigger
language plpgsql set search_path=public as $$
begin
  if new.conceded_goalkeeper_id is not null and not exists (
    select 1 from public.match_player_positions p join public.session_matches m on m.id=p.match_id
    where p.match_id=new.match_id and p.player_id=new.conceded_goalkeeper_id
      and p.position='goalkeeper' and p.participated
      and p.session_team_id in (m.team_a_id,m.team_b_id) and p.session_team_id<>new.session_team_id
  ) then raise exception 'Select a confirmed opposing goalkeeper for this match'; end if;
  return new;
end;
$$;
create trigger validate_goalkeeper before insert or update on public.goals
for each row execute function public.validate_conceded_goalkeeper();

create function public.confirm_match_positions(p_match_id uuid,p_players jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare m public.session_matches; s public.sessions; item jsonb; pid uuid; tid uuid; pos text;
begin
  select * into m from public.session_matches where id=p_match_id for update;
  select * into s from public.sessions where id=m.session_id for update;
  if not coalesce(public.performance_access(s.program_id) and public.program_role(s.program_id) in ('manager','captain')
    and public.is_program_module_enabled(s.program_id,'scores'),false) then raise exception 'Score management access required'; end if;
  if jsonb_typeof(p_players)<>'array' or jsonb_array_length(p_players)=0 then raise exception 'Provide match participants'; end if;
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
create view public.match_performance_detail as
with facts as (
  select s.id session_id,s.season_id,s.program_id,m.id match_id,m.match_number,p.player_id,
    pl.display_name player_name,p.session_team_id,p.position,
    coalesce(gf.n,0)::integer goals_for,coalesce(ga.n,0)::integer goals_against,
    coalesce(ind.g,0)::integer goals,coalesce(ind.a,0)::integer assists,
    case when p.position='goalkeeper' and coalesce(ga.unknown,0)=0 then coalesce(k.n,0)::integer end keeper_conceded,
    p.position='goalkeeper' and coalesce(ga.n,0)=0 clean_sheet,
    coalesce(ga.unknown,0)>0 and p.position='goalkeeper' keeper_attribution_incomplete
  from public.match_player_positions p
  join public.session_matches m on m.id=p.match_id and m.result_status='played'
  join public.sessions s on s.id=m.session_id
  join public.players pl on pl.id=p.player_id
  join public.session_team_players roster on roster.session_id=s.id and roster.player_id=p.player_id and roster.session_team_id=p.session_team_id
  left join lateral(select sum(goal_count) n from public.goals where match_id=m.id and session_team_id=p.session_team_id) gf on true
  left join lateral(select sum(goal_count) n,sum(goal_count) filter(where conceded_goalkeeper_id is null) unknown from public.goals where match_id=m.id and session_team_id<>p.session_team_id) ga on true
  left join lateral(select sum(goal_count) filter(where scorer_id=p.player_id and goal_type='goal') g,
    sum(goal_count) filter(where assist_player_id=p.player_id and goal_type='goal') a from public.goals where match_id=m.id) ind on true
  left join lateral(select sum(goal_count) n from public.goals where match_id=m.id and conceded_goalkeeper_id=p.player_id) k on true
  where p.participated and p.session_team_id in(m.team_a_id,m.team_b_id)
)
select *,public.match_performance_points_v1(position,goals_for,goals_against,goals,assists,keeper_conceded) breakdown from facts;

create view public.valid_performance_votes as
select v.* from public.captain_performance_votes v
join public.sessions s on s.id=v.session_id and s.status='completed'
join public.session_teams captain on captain.id=v.captain_team_id and captain.session_id=s.id
where exists(select 1 from public.program_members pm where pm.program_id=s.program_id and pm.profile_id=v.voter_id
  and pm.status='active' and pm.player_id=captain.captain_player_id)
and exists(select 1 from public.match_performance_detail d where d.session_id=s.id and d.player_id=v.player_id and d.position=v.category)
and not exists(select 1 from public.session_team_players own where own.session_id=s.id and own.session_team_id=captain.id and own.player_id=v.player_id);

create view public.session_performance_results as
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
group by d.session_id,d.season_id,d.program_id,d.player_id,d.player_name,v.n;

create function public.nominate_session_player(p_session_id uuid,p_team_id uuid,p_category text,p_player_id uuid) returns void
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

create function public.close_performance_voting(p_session_id uuid,p_closed boolean) returns void
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

create function public.session_performance(p_session_id uuid) returns jsonb
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

create function public.season_performance(p_season_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare program uuid;
begin
  select program_id into program from public.seasons where id=p_season_id;
  if not coalesce(public.performance_access(program),false) then raise exception 'Program access required'; end if;
  return coalesce((select jsonb_agg(to_jsonb(r) order by position,average_match_rating desc,player_name) from (
    select d.player_id,d.player_name,d.position,count(*) matches_played,count(distinct d.session_id) sessions_played,
      round(avg((d.breakdown->>'rating')::numeric),2) average_match_rating,
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
