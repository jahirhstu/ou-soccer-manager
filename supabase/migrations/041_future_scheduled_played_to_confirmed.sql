update public.attendance
set status = 'confirmed'
from public.sessions
where sessions.id = attendance.session_id
  and attendance.status = 'played'
  and sessions.status = 'scheduled'
  and sessions.session_date >= (now() at time zone 'America/Toronto')::date;
