import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import { fingerprint, snapshot, schemaDifferences, sha256 } from "./demo/maintenance";

async function main() {
  const action=process.argv[2];
  if(!['upgrade','cleanup','verify'].includes(action)) throw new Error('Use upgrade, cleanup, or verify. Preview is the default.');
  const env=parseEnv(readFileSync('.env.local','utf8'));
  if(!env.NEXT_PUBLIC_SUPABASE_URL || !env.DATABASE_URL) throw new Error('Missing development API or database URL.');
  const plan=JSON.parse(readFileSync('scripts/generated/dev-maintenance.local.json','utf8'));
  const url=new URL(env.NEXT_PUBLIC_SUPABASE_URL), dbUrl=new URL(env.DATABASE_URL);
  const ref=url.hostname.split('.')[0];
  if(ref!==plan.projectRef||(dbUrl.hostname!==`db.${ref}.supabase.co`&&decodeURIComponent(dbUrl.username)!==`postgres.${ref}`)) throw new Error('Target does not match the inspected development project.');
  for(const {file,hash} of plan.files) if(sha256(readFileSync(`supabase/migrations/${file}`,'utf8'))!==hash) throw new Error('Migration source changed. Prepare and review a new plan.');
  const execute=process.argv.includes('--execute');
  if(execute && !process.argv.includes(`--confirm=${ref}:${action.toUpperCase()}`)) throw new Error(`Explicit confirmation required: --confirm=${ref}:${action.toUpperCase()}`);
  if(execute && action==='cleanup' && !process.argv.includes('--backup-confirmed')) throw new Error('Back up first and pass --backup-confirmed. Cleanup is irreversible without a backup.');
  const sql=postgres(env.DATABASE_URL,{max:1,prepare:false,ssl:'require',connect_timeout:15});
  try {
    const current=await sql.begin('read only',tx=>snapshot(q=>tx.unsafe(q)));
    const differences=schemaDifferences(current,plan.target);
    if(action==='verify') {
      console.log(differences.length?differences:'Schema matches develop (legacy columns allowed).');
      if(differences.length) process.exitCode=1;
      return;
    }
    if(action==='upgrade' && differences.length===0) {console.log('Schema is already up to date.');return;}
    if(action==='upgrade' && fingerprint(current)!==plan.beforeFingerprint) throw new Error('Schema changed since inspection. Stop and prepare a new reviewed plan.');
    if(action==='cleanup' && differences.length) throw new Error('Upgrade and verify the schema before cleanup.');
    const source=readFileSync(`scripts/generated/dev-${action}.sql`,'utf8');
    if(sha256(source)!==plan[`${action}Hash`]) throw new Error('Generated SQL has changed since plan preparation.');
    const counts=await sql`select (select count(*) from auth.users) users,(select count(*) from public.players) players,(select count(*) from public.sessions) sessions`;
    console.log({projectRef:ref,action,execute,counts:counts[0]});
    if(!execute){console.log('Preview only. Review SQL and the development database guide before executing.');return;}
    let supabase:ReturnType<typeof createClient>|undefined;
    let userIds:string[]=[];
    if(action==='cleanup') {
      const secret=env.SUPABASE_SECRET_KEY??env.SUPABASE_SERVICE_ROLE_KEY;
      if(!secret) throw new Error('Set SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) for Auth cleanup.');
      if(Number((await sql`select count(*) as n from storage.objects`)[0].n)>0) throw new Error('Storage objects exist. Remove them through the Storage API after backup, then retry.');
      supabase=createClient(url.toString(),secret,{auth:{persistSession:false,autoRefreshToken:false}});
      for(let page=1;;page++) {
        const {data,error}=await supabase.auth.admin.listUsers({page,perPage:1000});
        if(error) throw new Error('Auth admin preflight failed. No data deleted.');
        userIds.push(...data.users.map(u=>u.id)); if(data.users.length<1000) break;
      }
      const databaseUsers=await sql`select id from auth.users order by id`;
      if(JSON.stringify(databaseUsers.map(u=>u.id).sort())!==JSON.stringify([...userIds].sort())) throw new Error('API/database Auth user lists differ. Stop all writes and check credentials.');
    }
    await sql.begin(async tx=>{
      await tx`set local lock_timeout='10s'`;
      await tx`select pg_advisory_xact_lock(hashtext('development-maintenance'))`;
      const now=await snapshot(q=>tx.unsafe(q));
      if(fingerprint(now)!==fingerprint(current)) throw new Error('Concurrent schema change detected.');
      await tx.unsafe(source);
      const remaining=schemaDifferences(await snapshot(q=>tx.unsafe(q)),plan.target);
      if(remaining.length) throw new Error(`Post-operation schema verification failed: ${remaining.join('; ')}`);
      if(action==='upgrade') {
        await tx.unsafe('create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations(version text primary key,statements text[],name text);');
        const history=await tx`select version from supabase_migrations.schema_migrations`;
        if(history.length) throw new Error('Migration history is no longer empty. Review history before baselining.');
        for(const {file} of plan.files) {
          const [version,...name]=file.replace(/\.sql$/,'').split('_');
          await tx`insert into supabase_migrations.schema_migrations(version,name,statements) values (${version},${name.join('_')},${tx.array([readFileSync(`supabase/migrations/${file}`,'utf8')])})`;
        }
      }
    });
    if(supabase) {
      for(const id of userIds) {
        const {error}=await supabase.auth.admin.deleteUser(id);
        if(error) throw new Error('Application cleanup committed, but Auth deletion failed. Keep the app offline and rerun cleanup; do not seed yet.');
      }
      if(Number((await sql`select count(*) as n from auth.users`)[0].n)!==0) throw new Error('New Auth users appeared during cleanup. Keep the app offline and rerun.');
    }
    console.log(`${action} completed. ${action==='cleanup'?'Auth users removed; ready for demo seed.':'Schema verified and current migration history baselined.'}`);
  } finally {await sql.end({timeout:2});}
}
main().catch(e=>{console.error(e.code?`Database operation failed (${e.code}). No credentials printed.`:e.message);process.exitCode=1;});
