-- Preserve historical records while making their existing parent scope explicit.
do $$
declare
  target text;
  parent text;
  parent_key text;
  invalid_count bigint;
begin
  foreach target in array array['payments','ledger_entries','session_player_charges','club_expenses',
    'attendance','dropouts','goals','session_matches','session_team_players','session_teams','whatsapp_imports'] loop
    if target in ('attendance','dropouts','goals','session_matches','session_team_players','session_teams') then
      parent := 'sessions'; parent_key := 'session_id';
    else
      parent := 'seasons'; parent_key := 'season_id';
    end if;
    execute format('select count(*) from public.%I child join public.%I parent on parent.id=child.%I
      where child.organization_id <> parent.organization_id
         or (child.program_id is not null and child.program_id is distinct from parent.program_id)',target,parent,parent_key)
      into invalid_count;
    if invalid_count > 0 then raise exception 'Conflicting historical scope in %; review before upgrading',target; end if;
    execute format('update public.%I child set program_id=parent.program_id
      from public.%I parent where parent.id=child.%I and child.program_id is null and parent.program_id is not null',target,parent,parent_key);
  end loop;
end;
$$;
