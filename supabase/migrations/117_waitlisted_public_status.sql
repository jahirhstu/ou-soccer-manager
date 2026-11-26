-- Rebuild only report contracts; scoped visibility and financial rules stay intact.
drop function if exists public.scoped_public_player_report(text,text);
drop function if exists public.internal_scoped_player_report(text,text);
drop function public.public_player_report();
-- Confirmed signup rosters identify season members even before payment or attendance.
-- Use the reviewed player UUIDs saved by the importer, never a name match.
create function public.public_player_report()
returns table(
  player_id uuid, player_name text, season_id uuid, season_name text,
  total_paid_amount numeric, total_played_sessions numeric,
  confirmed_sessions numeric, estimated_used_amount numeric,
  credit_amount numeric, owes_money numeric, balance_amount numeric,
  goals integer, assists integer, appearances integer,
  last_attended_sessions text[], latest_session text, upcoming_session text, waitlisted_sessions numeric, upcoming_waitlisted_session text
)
language sql stable security definer set search_path = public as $$
  with signup_roster as (
    select distinct wi.season_id, wi.organization_id,
      imported_player ->> 'matchedPlayerId' player_id
    from public.whatsapp_imports wi
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(wi.parsed_json -> 'players') = 'array'
        then wi.parsed_json -> 'players' else '[]'::jsonb end
    ) imported_player
    where wi.status = 'confirmed'
      and wi.parsed_json ->> 'importType' = 'season_signup'
      and imported_player ->> 'matchedPlayerId' is not null
  ),
  attendance_usage as (
    select a.player_id, s.season_id,
      count(*) filter (
        where a.status in ('played', 'replacement')
          or (a.status = 'confirmed' and (s.status = 'completed' or s.session_date < (now() at time zone 'America/Toronto')::date))
      )::numeric total_played_sessions,
      count(*) filter (
        where a.status = 'confirmed'
          and s.status = 'scheduled'
          and s.session_date >= (now() at time zone 'America/Toronto')::date
      )::numeric confirmed_sessions,
      coalesce(sum(case
        when a.status in ('played', 'replacement')
          or (a.status = 'confirmed' and (s.status = 'completed' or s.session_date < (now() at time zone 'America/Toronto')::date))
          then coalesce(spc.amount, s.price_per_session, seasons.price_per_session)
        when a.status in ('confirmed', 'played', 'replacement') and spc.id is not null
          then spc.amount
        else 0 end), 0) estimated_used_amount
    from public.attendance a
    join public.sessions s on s.id = a.session_id
    join public.seasons seasons on seasons.id = s.season_id
    left join public.session_player_charges spc
      on spc.session_id = a.session_id and spc.player_id = a.player_id
    group by a.player_id, s.season_id
  ),
  scored as (
    select g.scorer_id player_id, s.season_id, coalesce(sum(g.goal_count), 0)::integer goals
    from public.goals g join public.sessions s on s.id = g.session_id
    where coalesce(g.goal_type, 'goal') = 'goal'
    group by g.scorer_id, s.season_id
  ),
  assisted as (
    select g.assist_player_id player_id, s.season_id, count(g.id)::integer assists
    from public.goals g join public.sessions s on s.id = g.session_id
    where g.assist_player_id is not null and coalesce(g.goal_type, 'goal') = 'goal'
    group by g.assist_player_id, s.season_id
  ),
  completed_sessions as (
    select ranked.player_id, ranked.season_id,
      array_agg(ranked.session_label order by ranked.session_date desc, ranked.created_at desc) last_attended_sessions,
      max(ranked.session_label) filter (where ranked.rn = 1) latest_session
    from (
      select a.player_id, s.season_id, s.session_date, s.created_at,
        coalesce(nullif(s.name, ''), s.session_date::text) session_label,
        row_number() over (partition by a.player_id, s.season_id order by s.session_date desc, s.created_at desc) rn
      from public.attendance a join public.sessions s on s.id = a.session_id
      where a.status = 'played'
        or (a.status in ('replacement', 'confirmed')
          and (s.status = 'completed' or s.session_date < (now() at time zone 'America/Toronto')::date))
    ) ranked
    where ranked.rn <= 3
    group by ranked.player_id, ranked.season_id
  ),
  waitlist_usage as (
    select a.player_id,s.season_id,count(*)::numeric waitlisted_sessions,
      (array_agg(coalesce(nullif(s.name,''),s.session_date::text) order by s.session_date,s.created_at))[1] upcoming_waitlisted_session
    from attendance a join sessions s on s.id=a.session_id
    where a.status='waitlisted' and s.status='scheduled' and s.session_date >= (now() at time zone 'America/Toronto')::date
    group by a.player_id,s.season_id
  ),
  upcoming_sessions as (
    select player_id, season_id, session_label upcoming_session
    from (
      select a.player_id, s.season_id,
        coalesce(nullif(s.name, ''), s.session_date::text) session_label,
        row_number() over (partition by a.player_id, s.season_id order by s.session_date asc, s.created_at asc) rn
      from public.attendance a join public.sessions s on s.id = a.session_id
      where a.status in ('confirmed', 'replacement')
        and s.status = 'scheduled'
        and s.session_date >= (now() at time zone 'America/Toronto')::date
    ) ranked where rn = 1
  )
  select p.id, p.display_name, s.id, s.name,
    coalesce(ps.total_paid_amount, 0),
    coalesce(u.total_played_sessions, 0),
    coalesce(u.confirmed_sessions, 0),
    coalesce(u.estimated_used_amount, 0),
    coalesce(ps.credit_amount, 0),
    coalesce(ps.owes_money, 0),
    coalesce(ps.credit_amount, 0) - coalesce(ps.owes_money, 0),
    coalesce(sc.goals, 0), coalesce(ast.assists, 0),
    coalesce(u.total_played_sessions, 0)::integer,
    coalesce(cs.last_attended_sessions, array[]::text[]),
    cs.latest_session, ups.upcoming_session, coalesce(wu.waitlisted_sessions,0), wu.upcoming_waitlisted_session
  from public.players p
  cross join public.seasons s
  left join public.player_season_payment_summary ps
    on ps.player_id = p.id and ps.season_id = s.id
  left join signup_roster sr
    on sr.player_id = p.id::text and sr.season_id = s.id
      and sr.organization_id = p.organization_id
  left join attendance_usage u on u.player_id = p.id and u.season_id = s.id
  left join scored sc on sc.player_id = p.id and sc.season_id = s.id
  left join assisted ast on ast.player_id = p.id and ast.season_id = s.id
  left join completed_sessions cs on cs.player_id = p.id and cs.season_id = s.id
  left join waitlist_usage wu on wu.player_id=p.id and wu.season_id=s.id
  left join upcoming_sessions ups on ups.player_id = p.id and ups.season_id = s.id
  where p.status = 'active' and p.organization_id = s.organization_id
    and (coalesce(wu.waitlisted_sessions,0)>0 or sr.player_id is not null
      or coalesce(ps.total_paid_amount, 0) > 0
      or coalesce(ps.credit_amount, 0) > 0
      or coalesce(ps.owes_money, 0) > 0
      or coalesce(u.total_played_sessions, 0) > 0
      or coalesce(u.confirmed_sessions, 0) > 0
      or coalesce(u.estimated_used_amount, 0) > 0
      or coalesce(sc.goals, 0) > 0
      or coalesce(ast.assists, 0) > 0
      or cs.latest_session is not null
      or ups.upcoming_session is not null)
  order by s.start_date desc nulls last, s.name, p.display_name;
$$;

-- Scoped wrappers
do $migration$ begin
if to_regclass('public.organizations') is not null then
execute $sql$create or replace function public.scoped_public_player_report(p_organization_slug text, p_program_slug text default null)
returns table(
  player_id uuid, player_name text, season_id uuid, season_name text,
  total_paid_amount numeric, total_played_sessions numeric, confirmed_sessions numeric,
  estimated_used_amount numeric, credit_amount numeric, owes_money numeric, balance_amount numeric,
  goals integer, assists integer, appearances integer, last_attended_sessions text[],
  latest_session text, upcoming_session text, waitlisted_sessions numeric, upcoming_waitlisted_session text
)
language sql stable security definer set search_path = public as $$
  select report.player_id, report.player_name, report.season_id, report.season_name,
    case when settings.public_payments_enabled then report.total_paid_amount else null end,
    report.total_played_sessions, report.confirmed_sessions,
    case when settings.public_balances_enabled then report.estimated_used_amount else null end,
    case when settings.public_balances_enabled then report.credit_amount else null end,
    case when settings.public_balances_enabled then report.owes_money else null end,
    case when settings.public_balances_enabled then report.balance_amount else null end,
    report.goals, report.assists, report.appearances, report.last_attended_sessions,
    report.latest_session, report.upcoming_session, report.waitlisted_sessions, report.upcoming_waitlisted_session
  from public.resolve_enabled_public_scope(p_organization_slug, p_program_slug) scope
  join public.organization_settings settings on settings.organization_id = scope.organization_id
  join public.seasons season
    on season.organization_id = scope.organization_id
   and (scope.program_id is null or season.program_id = scope.program_id)
  join public.public_player_report() report on report.season_id = season.id;
$$;

$sql$;
execute $sql$create or replace function public.internal_scoped_player_report(p_organization_slug text, p_program_slug text default null)
returns table(player_id uuid, player_name text, season_id uuid, season_name text,
  total_paid_amount numeric, total_played_sessions numeric, confirmed_sessions numeric,
  estimated_used_amount numeric, credit_amount numeric, owes_money numeric, balance_amount numeric,
  goals integer, assists integer, appearances integer, last_attended_sessions text[], latest_session text, upcoming_session text, waitlisted_sessions numeric, upcoming_waitlisted_session text)
language sql stable security definer set search_path = public as $$
  select report.* from public.organizations o
  join public.seasons s on s.organization_id = o.id
  join public.programs p on p.id = s.program_id
  join public.public_player_report() report on report.season_id = s.id
  where o.slug = public.normalize_slug(p_organization_slug)
    and (nullif(public.normalize_slug(p_program_slug), '') is null or p.slug = public.normalize_slug(p_program_slug))
    and public.can_manage_program_finance(p.id);
$$;

$sql$;
end if;
end $migration$;
do $migration$ begin
 if exists(select 1 from pg_roles where rolname='service_role') then
  revoke all on function public.public_player_report() from public,anon,authenticated;
  grant execute on function public.public_player_report() to service_role;
  revoke all on function public.scoped_public_player_report(text,text) from public;
  grant execute on function public.scoped_public_player_report(text,text) to anon,authenticated,service_role;
  revoke all on function public.internal_scoped_player_report(text,text) from public,anon;
  grant execute on function public.internal_scoped_player_report(text,text) to authenticated,service_role;
 end if;
end $migration$;
