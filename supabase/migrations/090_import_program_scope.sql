-- Imports and legacy writes inherit scope from their selected season/session,
-- rather than the signed-in user's first organization or a default program.
alter table public.whatsapp_imports add column if not exists program_id uuid references public.programs(id);
update public.whatsapp_imports wi set program_id = s.program_id
from public.seasons s where s.id = wi.season_id and wi.program_id is null;
update public.whatsapp_imports wi set program_id = s.program_id
from public.sessions s where s.id = wi.session_id and wi.program_id is null;

create or replace function public.derive_season_program_scope()
returns trigger language plpgsql set search_path = public as $$
declare
  payload jsonb := to_jsonb(new);
  parent_season uuid := nullif(payload->>'season_id','')::uuid;
  parent_session uuid := nullif(payload->>'session_id','')::uuid;
  session_season uuid;
  scope_org uuid;
  scope_program uuid;
  player_key text;
begin
  if parent_session is not null then
    select season_id into session_season from public.sessions where id = parent_session;
    if session_season is null then raise exception 'Session is unavailable'; end if;
    if parent_season is not null and parent_season <> session_season then
      raise exception 'Session must belong to the selected season';
    end if;
    parent_season := session_season;
  end if;
  if parent_season is null then return new; end if;
  select organization_id, program_id into scope_org, scope_program from public.seasons where id = parent_season;
  if scope_program is null then raise exception 'Season program is unavailable'; end if;
  if new.program_id is not null and new.program_id <> scope_program then
    raise exception 'Program must match the selected season';
  end if;
  foreach player_key in array array['player_id','related_player_id','original_player_id','replacement_player_id','scorer_id','assist_player_id'] loop
    if nullif(payload->>player_key,'') is not null and not exists (
      select 1 from public.players p where p.id = (payload->>player_key)::uuid and p.organization_id = scope_org
    ) then raise exception 'Player must belong to the selected organization'; end if;
  end loop;
  new.organization_id := scope_org;
  new.program_id := scope_program;
  return new;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array['sessions','payments','attendance','dropouts','ledger_entries',
    'session_player_charges','session_teams','session_team_players','session_matches','goals','club_expenses','whatsapp_imports'] loop
    execute format('create trigger a_derive_season_program_scope before insert or update on public.%I
      for each row execute function public.derive_season_program_scope()', table_name);
  end loop;
  foreach table_name in array array['seasons','sessions'] loop
    execute format('create policy integrated_activity_manager on public.%I for all to authenticated
      using (public.can_manage_program_finance(program_id, ''activities''))
      with check (public.can_manage_program_finance(program_id, ''activities''))', table_name);
  end loop;
end;
$$;

create policy integrated_import_scope on public.whatsapp_imports as restrictive for all to authenticated
using (public.can_access_program(program_id)) with check (public.can_access_program(program_id));
create policy integrated_import_manager on public.whatsapp_imports for all to authenticated
using (public.can_manage_program_finance(program_id, 'whatsapp_import'))
with check (public.can_manage_program_finance(program_id, 'whatsapp_import'));
create trigger prevent_disabled_program_writes before insert or update or delete on public.whatsapp_imports
for each row execute function public.prevent_disabled_program_writes('whatsapp_import');

create policy integrated_import_alias_manager on public.player_aliases for all to authenticated
using (exists (select 1 from public.programs p where p.organization_id = player_aliases.organization_id
  and public.can_manage_program_finance(p.id, 'whatsapp_import')))
with check (exists (select 1 from public.programs p where p.organization_id = player_aliases.organization_id
  and public.can_manage_program_finance(p.id, 'whatsapp_import')));
create policy integrated_import_playground_manager on public.playgrounds for insert to authenticated
with check (exists (select 1 from public.programs p where p.organization_id = playgrounds.organization_id
  and public.can_manage_program_finance(p.id, 'whatsapp_import')));
