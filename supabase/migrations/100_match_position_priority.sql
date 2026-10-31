create table public.match_score_positions (
  match_id uuid not null references public.session_matches(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  position text check(position in ('goalkeeper','defender','midfielder','forward')),
  updated_at timestamptz not null default now(),
  primary key(match_id,player_id)
);

alter table public.match_score_positions enable row level security;
revoke all on public.match_score_positions from public,anon,authenticated;

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

create function public.resolved_match_player_position(p_match_id uuid,p_player_id uuid)
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
