import { readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import postgres from "postgres";
import { schemaQueries, attributionLinks } from "./demo/schema";

async function main() {
  const env=parseEnv(readFileSync(".env.local","utf8"));
  if(!env.DATABASE_URL || !env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("Missing database or API URL.");
  const db=new URL(env.DATABASE_URL), ref=new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  if(db.hostname!==`db.${ref}.supabase.co` && decodeURIComponent(db.username)!==`postgres.${ref}`) throw new Error("Database/API project mismatch.");
  const sql=postgres(env.DATABASE_URL,{max:1,prepare:false,ssl:"require",connect_timeout:15});
  try {
    const result:Record<string,unknown>={projectRef:ref,inspectedAt:new Date().toISOString()};
    await sql.begin("read only",async tx=>{
      await tx`set local statement_timeout='30s'`;
      for(const [name,query] of Object.entries(schemaQueries)) result[name]=await tx.unsafe(query);
      const history=await tx`select to_regclass('supabase_migrations.schema_migrations') is not null as exists`;
      result.migrations=history[0].exists?await tx`select version,name from supabase_migrations.schema_migrations order by version`:[];
      result.counts=await tx`select (select count(*) from auth.users) auth_users,(select count(*) from public.players) players,(select count(*) from public.sessions) sessions`;
      result.orphans={};
      for(const [table,column] of attributionLinks) (result.orphans as Record<string,unknown>)[table]=(await tx.unsafe(`select count(*) as count from public.${table} t where ${column} is not null and not exists(select 1 from public.profiles p where p.id=t.${column})`))[0].count;
      result.storage=await tx`select count(*) as objects from storage.objects`;
    });
    writeFileSync("dev-database.local.json",JSON.stringify(result,null,2),{mode:0o600});
    console.log(JSON.stringify({connected:true,counts:result.counts,migrations:result.migrations,orphans:result.orphans,storage:result.storage,report:"dev-database.local.json"},null,2));
  } finally {await sql.end({timeout:2});}
}
main().catch(e=>{console.error("Inspection failed:",e.code??"unknown");process.exitCode=1;});
