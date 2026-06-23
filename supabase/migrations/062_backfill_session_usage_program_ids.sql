update public.session_player_charges spc
set program_id = sessions.program_id
from public.sessions sessions
where spc.session_id = sessions.id
  and spc.program_id is null
  and sessions.program_id is not null;

update public.ledger_entries le
set program_id = coalesce(
  (select sessions.program_id from public.sessions sessions where sessions.id = le.session_id),
  seasons.program_id
)
from public.seasons seasons
where le.season_id = seasons.id
  and le.program_id is null
  and coalesce(
    (select sessions.program_id from public.sessions sessions where sessions.id = le.session_id),
    seasons.program_id
  ) is not null;
