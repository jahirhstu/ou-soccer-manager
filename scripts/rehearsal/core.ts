import { parseEnv } from 'node:util';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import postgres from 'postgres';

export function project(url:string,api:string) {
  const db=new URL(url),ref=new URL(api).hostname.split('.')[0];
  if(db.hostname!==`db.${ref}.supabase.co`&&decodeURIComponent(db.username)!==`postgres.${ref}`) throw new Error('Database/API project mismatch');
  return {url,ref};
}
export function connections() {
  const p=parseEnv(readFileSync('.env.production.local','utf8')),d=parseEnv(readFileSync('.env.local','utf8'));
  const source=project(p.PRODUCTION_DATABASE_URL!,p.PRODUCTION_SUPABASE_URL!);
  const target=project(d.DATABASE_URL!,d.NEXT_PUBLIC_SUPABASE_URL!);
  if(source.ref===target.ref) throw new Error('Production and development must be different projects');
  return {source,target};
}
export function connect(url:string,readOnly=false) {
  return postgres(url,{max:1,prepare:false,ssl:'require',connect_timeout:20,onnotice:()=>{},
    connection:{application_name:'ou-rehearsal',...(readOnly?{default_transaction_read_only:true}:{})}});
}
export const quoteId=(value:string)=>'"'+value.replaceAll('"','""')+'"';
export const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export const protectedTables=['players','seasons','sessions','attendance','dropouts','goals','session_matches','session_teams','session_team_players','session_team_lineups','payments','ledger_entries','session_player_charges','club_expenses','club_balance_transfers','whatsapp_imports','notifications'];
type Query=(q:string)=>Promise<Record<string,unknown>[]>;
export async function checksums(query:Query,protectedOnly=false) {
  const tables=protectedOnly?protectedTables:(await query("select tablename from pg_tables where schemaname='public' order by tablename")).map(r=>String(r.tablename));
  const output:Record<string,unknown>={};
  for(const table of tables) {
    const exclusions=protectedOnly?" - array['program_id','updated_at']::text[]":'';
    output[table]=(await query(`select count(*)::text count,md5(coalesce(string_agg(h,'' order by h),'')) hash from
      (select md5((to_jsonb(t)${exclusions})::text) h from public.${quoteId(table)} t) rows`))[0];
  }
  return output;
}
export async function preflight(query:Query) {
  for(const [name,sql] of Object.entries({
    storage:"select count(*) n from storage.objects",vault:"select count(*) n from vault.secrets",
    mfa:"select count(*) n from auth.mfa_factors",nonEmail:"select count(*) n from auth.identities where provider<>'email'",
    publicExtensions:"select count(*) n from pg_extension e join pg_namespace n on n.oid=e.extnamespace where n.nspname='public'",
    publicPartitions:"select count(*) n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and (c.relkind='p' or c.relispartition)"
  })) if(Number((await query(sql))[0].n)>0) throw new Error(`Unsupported ${name} found. Stop for a separately reviewed restore.`);
  const jobs=await query("select to_regclass('cron.job') is not null present");
  if(jobs[0].present&&Number((await query('select count(*) n from cron.job where active'))[0].n)>0) throw new Error('Active database jobs found; stop before restore.');
  const hooks=await query("select count(*) n from pg_trigger t join pg_proc p on p.oid=t.tgfoid join pg_namespace n on n.oid=p.pronamespace where not t.tgisinternal and n.nspname in ('supabase_functions','net')");
  if(Number(hooks[0].n)>0) throw new Error('Database webhook triggers require review.');
}
export async function authSummary(query:Query) {
  return (await query("select count(*)::text count,md5(coalesce(string_agg(md5(id::text||coalesce(email,'')||coalesce(encrypted_password,'')),'' order by id),'')) hash from auth.users"))[0];
}
export function assertSame(a:unknown,b:unknown,label:string) {
  if(JSON.stringify(a)!==JSON.stringify(b)) throw new Error(`${label} does not match; keep development offline.`);
}
