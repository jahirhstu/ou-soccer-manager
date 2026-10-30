-- No historical positions or participation are inferred from saved team membership.
create table public.match_player_positions (
  match_id uuid not null references public.session_matches on delete cascade,
  player_id uuid not null references public.players,
  session_team_id uuid not null references public.session_teams on delete cascade,
  position text check(position in ('goalkeeper','defender','midfielder','forward')),
  participated boolean not null,
  confirmed_by uuid not null references public.profiles,
  updated_at timestamptz not null default now(),
  primary key(match_id,player_id)
);
create index on public.match_player_positions(player_id);
create table public.performance_voting (
  session_id uuid primary key references public.sessions on delete cascade,
  closed boolean not null default false
);
create table public.performance_votes (
  session_id uuid not null references public.sessions on delete cascade,
  team_id uuid not null references public.session_teams on delete cascade,
  category text not null check(category in ('goalkeeper','defender','midfielder')),
  player_id uuid not null references public.players,
  voter_id uuid not null references public.profiles,
  updated_at timestamptz not null default now(),
  primary key(session_id,team_id,category)
);
create table public.performance_audit (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.sessions on delete cascade,
  actor_id uuid not null references public.profiles,
  action text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.goals add column conceded_goalkeeper_id uuid references public.players;
create index on public.goals(conceded_goalkeeper_id) where conceded_goalkeeper_id is not null;
alter table public.match_player_positions enable row level security;
alter table public.performance_voting enable row level security;
alter table public.performance_votes enable row level security;
alter table public.performance_audit enable row level security;
revoke all on public.match_player_positions,public.performance_votes,public.performance_voting,public.performance_audit from anon,authenticated;

create function public.performance_access(p_program uuid) returns boolean language sql stable security definer set search_path=public as $$
select auth.uid() is not null and (public.mobile_program_access(p_program) or coalesce(public.program_role(p_program)='manager',false));
$$;

create function public.performance_points_v1(pos text,gf integer,ga integer,g integer,a integer,k integer)
returns jsonb language sql immutable as $$
with parts as (select 2::numeric base,
  case when gf>ga then 2 when gf=ga then 1 else 0 end result,
  case when ga=0 then case pos when 'goalkeeper' then 4 when 'defender' then 3 when 'midfielder' then 1 else 0 end else 0 end defense,
  least(2,gf*case pos when 'goalkeeper' then .10 when 'defender' then .15 when 'midfielder' then .25 else .50 end) attack,
  least(4,g*case pos when 'goalkeeper' then 2 when 'defender' then 1 when 'midfielder' then 1.5 else 2.5 end
    +a*case pos when 'goalkeeper' then 1 when 'defender' then .75 else 1.5 end) individual,
  case pos when 'goalkeeper' then least(4,coalesce(k,ga)*.75) when 'defender' then least(3,ga*.5) when 'midfielder' then least(2,ga*.25) else 0 end penalty)
select jsonb_build_object('version',1,'base',base,'result',result,'defense',defense,'attack',attack,'individual',individual,'penalty',penalty,
  'rating',case when pos is not null then round(greatest(0,least(10,base+result+defense+attack+individual-penalty)),2) end) from parts;
$$;

-- Match scores remain authoritative, including imported games without goal details.
create view public.performance_match_results as
with facts as (
 select s.id session_id,s.season_id,s.program_id,m.id match_id,m.match_number,p.player_id,pl.display_name player_name,p.session_team_id,p.position,
 case when p.session_team_id=m.team_a_id then m.team_a_score else m.team_b_score end gf,
 case when p.session_team_id=m.team_a_id then m.team_b_score else m.team_a_score end ga,
 coalesce(ind.g,0)::integer goals,coalesce(ind.a,0)::integer assists,
 case when p.position='goalkeeper' and coalesce(conceded.attributed,0)=case when p.session_team_id=m.team_a_id then m.team_b_score else m.team_a_score end
   then coalesce(conceded.personal,0)::integer end goalkeeper_conceded
 from public.match_player_positions p join public.session_matches m on m.id=p.match_id and m.result_status='played'
 join public.sessions s on s.id=m.session_id join public.players pl on pl.id=p.player_id
 join public.session_team_players roster on roster.session_id=s.id and roster.player_id=p.player_id and roster.session_team_id=p.session_team_id
 left join lateral(select sum(goal_count) filter(where scorer_id=p.player_id and goal_type='goal') g,
   sum(goal_count) filter(where assist_player_id=p.player_id and goal_type='goal') a from public.goals where match_id=m.id) ind on true
 left join lateral(select sum(goal_count) filter(where conceded_goalkeeper_id is not null) attributed,
   sum(goal_count) filter(where conceded_goalkeeper_id=p.player_id) personal from public.goals where match_id=m.id and session_team_id<>p.session_team_id) conceded on true
 where p.participated and p.session_team_id in(m.team_a_id,m.team_b_id)
)
select *,position='goalkeeper' and ga=0 clean_sheet,
 position is null or (position='goalkeeper' and goalkeeper_conceded is null) incomplete,
 public.performance_points_v1(position,gf,ga,goals,assists,goalkeeper_conceded) breakdown from facts;

create view public.performance_valid_votes as
select v.* from public.performance_votes v join public.sessions s on s.id=v.session_id and s.status='completed'
join public.session_teams t on t.id=v.team_id and t.session_id=s.id
where exists(select 1 from public.program_members pm where pm.program_id=s.program_id and pm.profile_id=v.voter_id and pm.status='active' and pm.player_id=t.captain_player_id)
and exists(select 1 from public.performance_match_results d where d.session_id=s.id and d.player_id=v.player_id and d.position=v.category)
and not exists(select 1 from public.session_team_players own where own.session_id=s.id and own.session_team_id=t.id and own.player_id=v.player_id);

create view public.performance_session_results as
select d.session_id,d.season_id,d.program_id,d.player_id,d.player_name,count(*)::integer matches_played,
 count(*) filter(where position is not null)::integer rated_matches,
 array_agg(distinct position) filter(where position is not null) positions,
 round(sum(coalesce((breakdown->>'rating')::numeric,0))*4/count(*),2) match_points,
 least(60,coalesce(v.n,0)*30)::integer captain_points,
 round(sum(coalesce((breakdown->>'rating')::numeric,0))*4/count(*)+least(60,coalesce(v.n,0)*30),2) final_rating,
 sum(goals)::integer goals,sum(assists)::integer assists,bool_or(incomplete) incomplete
from public.performance_match_results d left join lateral(select count(*) n from public.performance_valid_votes v where v.session_id=d.session_id and v.player_id=d.player_id) v on true
group by d.session_id,d.season_id,d.program_id,d.player_id,d.player_name,v.n;
revoke all on public.performance_match_results,public.performance_valid_votes,public.performance_session_results from public,anon,authenticated;

create function public.performance_update(p_session_id uuid,p_action text,p_payload jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare s public.sessions; m public.session_matches; item jsonb; pid uuid; tid uuid; pos text; old_data jsonb;
begin
 select * into s from public.sessions where id=p_session_id for update;
 if not coalesce(public.performance_access(s.program_id),false) then raise exception 'Program access required'; end if;
 if p_action='positions' then
   if not coalesce(public.program_role(s.program_id) in ('manager','captain') and public.is_program_module_enabled(s.program_id,'scores'),false) then raise exception 'Score management access required'; end if;
   select * into m from public.session_matches where id=(p_payload->>'matchId')::uuid and session_id=s.id for update;
   if m.id is null then raise exception 'Match not in this session'; end if;
   if jsonb_typeof(p_payload->'players') is distinct from 'array' then raise exception 'Provide participants'; end if;
   if (select count(*)<>count(distinct value->>'playerId') from jsonb_array_elements(p_payload->'players')) then raise exception 'Duplicate player'; end if;
   select jsonb_agg(to_jsonb(p)) into old_data from public.match_player_positions p where match_id=m.id;
   for item in select value from jsonb_array_elements(p_payload->'players') loop
     pid:=(item->>'playerId')::uuid; pos:=nullif(item->>'position','');
     select session_team_id into tid from public.session_team_players where session_id=s.id and player_id=pid;
     if tid is null or tid not in(m.team_a_id,m.team_b_id) then raise exception 'Player not on match roster'; end if;
     if exists(select 1 from public.goals where match_id=m.id and conceded_goalkeeper_id=pid)
       and (pos is distinct from 'goalkeeper' or not coalesce((item->>'participated')::boolean,false)) then raise exception 'Correct goal goalkeeper assignments before changing this position'; end if;
     insert into public.match_player_positions(match_id,player_id,session_team_id,position,participated,confirmed_by)
       values(m.id,pid,tid,pos,coalesce((item->>'participated')::boolean,false),auth.uid())
       on conflict(match_id,player_id) do update set session_team_id=excluded.session_team_id,position=excluded.position,participated=excluded.participated,confirmed_by=auth.uid(),updated_at=now();
   end loop;
 elsif p_action='vote' then
   if s.status<>'completed' then raise exception 'Voting opens after session completion'; end if;
   if exists(select 1 from public.performance_voting where session_id=s.id and closed) then raise exception 'Voting is closed'; end if;
   tid:=(p_payload->>'teamId')::uuid;pid:=(p_payload->>'playerId')::uuid;pos:=p_payload->>'category';
   if not exists(select 1 from public.session_teams t join public.program_members pm on pm.program_id=s.program_id and pm.player_id=t.captain_player_id
     and pm.profile_id=auth.uid() and pm.status='active' where t.id=tid and t.session_id=s.id) then raise exception 'Only this team captain can vote'; end if;
   if exists(select 1 from public.session_team_players where session_id=s.id and session_team_id=tid and player_id=pid)
     or not exists(select 1 from public.performance_match_results where session_id=s.id and player_id=pid and position=pos) then raise exception 'Nominee must have played this position on another team'; end if;
   select to_jsonb(v) into old_data from public.performance_votes v where session_id=s.id and team_id=tid and category=pos;
   insert into public.performance_votes(session_id,team_id,category,player_id,voter_id) values(s.id,tid,pos,pid,auth.uid())
     on conflict(session_id,team_id,category) do update set player_id=excluded.player_id,voter_id=auth.uid(),updated_at=now();
 elsif p_action='close' then
   if public.program_role(s.program_id) is distinct from 'manager' then raise exception 'Manager access required'; end if;
   select to_jsonb(v) into old_data from public.performance_voting v where session_id=s.id;
   insert into public.performance_voting(session_id,closed) values(s.id,(p_payload->>'closed')::boolean)
     on conflict(session_id) do update set closed=excluded.closed;
 else raise exception 'Unknown operation'; end if;
 insert into public.performance_audit(session_id,actor_id,action,payload) values(s.id,auth.uid(),p_action,jsonb_build_object('before',old_data,'after',p_payload));
end;
$$;

create function public.session_performance(p_session_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare s public.sessions;
begin
 select * into s from public.sessions where id=p_session_id;
 if not coalesce(public.performance_access(s.program_id),false) then raise exception 'Program access required'; end if;
 return jsonb_build_object('session',jsonb_build_object('id',s.id,'name',s.name,'status',s.status,'seasonId',s.season_id),
 'canManage',public.program_role(s.program_id) in('manager','captain') and public.is_program_module_enabled(s.program_id,'scores'),'canClose',public.program_role(s.program_id)='manager',
 'closed',coalesce((select closed from public.performance_voting where session_id=s.id),false),
 'teams',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'canVote',exists(select 1 from public.program_members pm where pm.program_id=s.program_id and pm.profile_id=auth.uid() and pm.status='active' and pm.player_id=t.captain_player_id),
   'players',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name)),'[]') from public.session_team_players tp join public.players p on p.id=tp.player_id where tp.session_team_id=t.id))) from public.session_teams t where t.session_id=s.id),'[]'),
 'matches',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'number',m.match_number,'teamAId',m.team_a_id,'teamBId',m.team_b_id,'status',m.result_status) order by m.match_number) from public.session_matches m where m.session_id=s.id),'[]'),
 'positions',coalesce((select jsonb_agg(to_jsonb(p)) from public.match_player_positions p join public.session_matches m on m.id=p.match_id where m.session_id=s.id),'[]'),
 'results',coalesce((select jsonb_agg(to_jsonb(r) order by final_rating desc,player_name) from public.performance_session_results r where r.session_id=s.id),'[]'),
 'details',coalesce((select jsonb_agg(to_jsonb(r) order by match_number,player_name) from public.performance_match_results r where r.session_id=s.id),'[]'),
 'votes',coalesce((select jsonb_agg(to_jsonb(v)) from public.performance_valid_votes v where v.session_id=s.id),'[]'),
 'awards',coalesce((select jsonb_agg(to_jsonb(w)) from (select category,player_id,p.display_name player_name,count(*) nominations,dense_rank() over(partition by category order by count(*) desc) rank
   from public.performance_valid_votes v join public.players p on p.id=v.player_id where v.session_id=s.id group by category,player_id,p.display_name) w where rank=1),'[]'));
end;
$$;

create function public.season_performance(p_season_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare prog uuid;
begin
 select program_id into prog from public.seasons where id=p_season_id;
 if not coalesce(public.performance_access(prog),false) then raise exception 'Program access required'; end if;
 return coalesce((select jsonb_agg(to_jsonb(r) order by position,average_match_rating desc,player_name) from (
 select d.player_id,d.player_name,d.position,count(*) matches_played,count(distinct d.session_id) sessions_played,
 round(avg((d.breakdown->>'rating')::numeric),2) average_match_rating,
 (select count(*) from public.performance_valid_votes v join public.sessions s on s.id=v.session_id where s.season_id=p_season_id and v.player_id=d.player_id and v.category=d.position) nominations
 from public.performance_match_results d where d.season_id=p_season_id and d.position is not null group by d.player_id,d.player_name,d.position) r),'[]');
end;
$$;

create function public.validate_performance_goalkeeper() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.conceded_goalkeeper_id is not null and not exists(select 1 from public.match_player_positions p join public.session_matches m on m.id=p.match_id
   where p.match_id=new.match_id and p.player_id=new.conceded_goalkeeper_id and p.position='goalkeeper' and p.participated
   and p.session_team_id in(m.team_a_id,m.team_b_id) and p.session_team_id<>new.session_team_id)
 then raise exception 'Select a confirmed opposing goalkeeper'; end if;
 return new;
end;
$$;
create trigger validate_performance_goalkeeper before insert or update on public.goals for each row execute function public.validate_performance_goalkeeper();
revoke all on function public.performance_update(uuid,text,jsonb),public.session_performance(uuid),public.season_performance(uuid) from public,anon;
grant execute on function public.performance_update(uuid,text,jsonb),public.session_performance(uuid),public.season_performance(uuid) to authenticated;
