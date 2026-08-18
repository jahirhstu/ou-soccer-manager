create or replace function public.public_longest_winning_streaks(p_season_id uuid default null)
returns table(
  player_id uuid,
  player_name text,
  season_id uuid,
  season_name text,
  streak_count integer,
  start_session_date date,
  end_session_date date,
  session_names text[]
)
language sql
stable
security definer
set search_path = public
as $$
  with winning_streaks as (
    select *
    from public.public_player_session_streaks(p_season_id)
    where streak_type = 'winning'
  ),
  leaders as (
    select
      ws.*,
      row_number() over (
        partition by ws.player_id
        order by ws.end_session_date desc, ws.start_session_date desc
      ) player_streak_rank
    from winning_streaks ws
    where ws.streak_count = (select max(streak_count) from winning_streaks)
  )
  select
    player_id,
    player_name,
    season_id,
    season_name,
    streak_count,
    start_session_date,
    end_session_date,
    session_names
  from leaders
  where player_streak_rank = 1
  order by player_name;
$$;

grant execute on function public.public_longest_winning_streaks(uuid) to anon, authenticated, service_role;
