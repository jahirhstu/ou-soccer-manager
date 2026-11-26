drop function if exists public.signup_import_save(uuid,uuid,uuid,jsonb,boolean,boolean);
drop function if exists public.signup_import_existing_playground(uuid,text,text);
drop trigger if exists signup_import_attendance_ownership on public.attendance;
drop function if exists public.signup_import_attendance_ownership();
drop table if exists public.signup_import_attendance;
-- Historical draft JSON stays as audit evidence; the WhatsApp importer owns all new writes.
