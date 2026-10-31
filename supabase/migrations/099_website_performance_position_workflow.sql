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

create function public.performance_season_rows(p_season_id uuid)
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

create function public.scoped_public_position_leaderboards(
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

create function public.save_website_game_scores(p_session_id uuid,p_games jsonb)
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
