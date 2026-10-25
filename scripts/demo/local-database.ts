import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
export async function localDatabase() {
  const db=new PGlite({extensions:{pgcrypto}});
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions; create extension pgcrypto with schema extensions;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,updated_at timestamptz);
    create table auth.identities(user_id uuid,provider text,provider_id text,identity_data jsonb,updated_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select current_user::text $$;
    create publication supabase_realtime;
    grant usage on schema public,auth to anon,authenticated;
    alter default privileges in schema public grant all on tables to authenticated,service_role;
    alter default privileges in schema public grant usage,select on sequences to authenticated,service_role;`);
  return db;
}
