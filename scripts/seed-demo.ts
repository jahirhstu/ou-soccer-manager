import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { parseEnv } from "node:util";
import { accounts, buildDemoDataset, DATASET, demoId, type AccountIds } from "./demo/dataset";
import { snapshot, schemaDifferences } from "./demo/maintenance";

// Deliberately do not load .env.local: the demo has its own explicit target.
function loadDemoEnvironment() {
  if (!existsSync(".env.seed.local")) return;
  for (const [key,value] of Object.entries(parseEnv(readFileSync('.env.seed.local','utf8')))) process.env[key] ??= value;
}
function required(name: string) {
  const value=process.env[name];
  if (!value) throw new Error(`Set ${name} in .env.seed.local.`);
  return value;
}

async function main() {
  loadDemoEnvironment();
  let developmentTarget:Record<string,unknown>|undefined;
  if(process.argv.includes('--use-development-env')) {
    const env=parseEnv(readFileSync('.env.local','utf8'));
    if(!env.NEXT_PUBLIC_SUPABASE_URL || !env.DATABASE_URL) throw new Error('Missing development API or database URL.');
    const developmentSecret=env.SUPABASE_SECRET_KEY??env.SUPABASE_SERVICE_ROLE_KEY;
    if(!developmentSecret) throw new Error('Missing development Supabase secret/service-role key.');
    const plan=JSON.parse(readFileSync('scripts/generated/dev-maintenance.local.json','utf8'));
    developmentTarget=plan.target;
    if(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname!==`${plan.projectRef}.supabase.co`) throw new Error('Development project does not match the reviewed maintenance plan.');
    if(!process.argv.includes(`--confirm=${plan.projectRef}:SEED`)) throw new Error('Pass --confirm=PROJECT_REF:SEED to target the inspected development project.');
    process.env.SEED_SUPABASE_URL=env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SEED_DATABASE_URL=env.DATABASE_URL;
    process.env.SEED_SUPABASE_SECRET_KEY=developmentSecret;
  }
  const url=new URL(required("SEED_SUPABASE_URL"));
  const dbUrl=new URL(required("SEED_DATABASE_URL"));
  const secret=required("SEED_SUPABASE_SECRET_KEY");
  const password=required("SEED_USER_PASSWORD");
  if(password.length<12) throw new Error("Use a seed password of at least 12 characters.");
  const domain=process.env.SEED_EMAIL_DOMAIN??"demo.example.test";
  if(!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) throw new Error("SEED_EMAIL_DOMAIN must be a domain, not an email address.");
  const projectRef=url.hostname.split(".")[0];
  const local=["localhost","127.0.0.1"].includes(url.hostname);
  if(!local && !dbUrl.hostname.includes(projectRef) && !decodeURIComponent(dbUrl.username).includes(projectRef)) throw new Error("The Supabase API and database connection must point to the same project. Use its direct or session-pooler connection string.");
  const sql=postgres(dbUrl.toString(), { max:1, prepare:false, ssl:local?false:"require", connect_timeout:15 });
  const supabase=createClient(url.toString(),secret,{auth:{persistSession:false,autoRefreshToken:false}});
  try {
    if(developmentTarget) {
      const current=await sql.begin('read only',tx=>snapshot(q=>tx.unsafe(q)));
      if(schemaDifferences(current,developmentTarget).length) throw new Error('Development schema does not match the reviewed upgrade. Run upgrade and verify first.');
    }
    const exists=await sql`select to_regclass('public.players') is not null as ready`;
    if(!exists[0].ready) {
      if(!process.argv.includes("--migrate")) throw new Error("The database is empty. Run with --migrate to install the schema and seed it.");
      console.log("Installing migrations in the fresh database...");
      await sql.begin(async tx=>{
        await tx.unsafe("create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations(version text primary key, statements text[], name text);");
        for(const file of readdirSync("supabase/migrations").filter(f=>f.endsWith(".sql")).sort()) {
          const source=readFileSync(`supabase/migrations/${file}`,"utf8");
          await tx.unsafe(source);
          const [version,...parts]=file.replace(/\.sql$/,"").split("_");
          await tx`insert into supabase_migrations.schema_migrations(version,name,statements) values (${version},${parts.join("_")},${tx.array([source])})`;
        }
      });
    }
    const ready=await sql`select to_regprocedure('public.derive_season_program_scope()') is not null as ready`;
    if(!ready[0].ready) throw new Error("Apply the development migrations through 090 first. Existing schemas are never auto-upgraded by this seeder.");
    if((await sql`select id from audit_logs where id=${demoId("complete")}::uuid`).length) {
      console.log("This demo dataset is already installed. No data or passwords changed; your manual test edits are preserved."); return;
    }
    const populated=await sql`select exists(select 1 from seasons) or exists(select 1 from players) or exists(select 1 from payments) or exists(select 1 from platform_accounts) or exists(select 1 from organization_members) as populated`;
    if(populated[0].populated) throw new Error("Seed only a fresh migrated development database. Existing business data or privileged memberships were found; nothing was deleted.");
    const anchor=process.env.SEED_ANCHOR_DATE??new Intl.DateTimeFormat("en-CA",{timeZone:"America/Toronto",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
    const ids={} as AccountIds;
    const users=[];
    for(let page=1;;page++) {
      const {data,error}=await supabase.auth.admin.listUsers({page,perPage:1000});
      if(error) throw new Error(`Could not list seed accounts: ${error.message}`);
      users.push(...data.users); if(data.users.length<1000) break;
    }
    for(const key of accounts) {
      const email=`${key}@${domain}`, existing=users.find(u=>u.email?.toLowerCase()===email.toLowerCase());
      if(existing && existing.app_metadata?.demo_dataset!==DATASET) throw new Error(`The account ${email} already exists and is not owned by this dataset.`);
    }
    if(developmentTarget && users.some(user=>user.app_metadata?.demo_dataset!==DATASET)) throw new Error('Non-demo Auth accounts remain. Complete development cleanup before seeding.');
    console.log(`Preparing ${accounts.length} login accounts in ${url.hostname}...`);
    for(const key of accounts) {
      const email=`${key}@${domain}`, existing=users.find(u=>u.email?.toLowerCase()===email.toLowerCase());
      if(existing) { ids[key]=existing.id; continue; }
      const {data,error}=await supabase.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:`Demo ${key}`},app_metadata:{demo_dataset:DATASET}});
      if(error) throw new Error(`Could not create ${email}: ${error.message}`);
      ids[key]=data.user.id;
    }
    const dataset=buildDemoDataset(ids,anchor,domain,randomBytes(24).toString("hex"));
    console.log("Inserting the demo dataset in one database transaction...");
    await sql.begin(async tx=>{
      await tx`select pg_advisory_xact_lock(hashtext(${DATASET}))`;
      if((await tx`select id from audit_logs where id=${demoId("complete")}::uuid`).length) throw new Error("Another process has already seeded this database.");
      const occupied=await tx`select exists(select 1 from seasons) or exists(select 1 from players) or exists(select 1 from payments) or exists(select 1 from platform_accounts) or exists(select 1 from organization_members) as occupied`;
      if(occupied[0].occupied) throw new Error("Business data appeared during account preparation. Seed aborted without deleting it.");
      await tx.unsafe(dataset.sql);
    });
    const counts=await sql`select (select count(*) from organizations where slug like '%-demo') organizations,
      (select count(*) from seasons) seasons, (select count(*) from sessions) sessions,
      (select count(*) from session_matches) matches, (select count(*) from notifications) notifications`;
    const base=(process.env.SEED_WEBSITE_URL??"http://localhost:3003").replace(/\/$/,"");
    writeFileSync("seed-demo-manifest.local.json",JSON.stringify({dataset:DATASET,anchor,counts:counts[0],accounts:accounts.map(key=>({role:key,email:`${key}@${domain}`,id:ids[key]})),programs:dataset.programs.map(p=>({ ...p,dashboard:`${base}/${p.org}/${p.slug}/dashboard`,report:`${base}/${p.org}/${p.slug}/public/report` })),sessions:dataset.scenarioLinks,invitations:Object.fromEntries(Object.entries(dataset.invitationTokens).map(([key,token])=>[key,`${base}/invite/${token}`]))},null,2),{mode:0o600});
    console.log("Seed complete:",counts[0]);
    console.log(`Login: owner@${domain} (use SEED_USER_PASSWORD). Account directory and links: seed-demo-manifest.local.json`);
  } finally { await sql.end(); }
}
main().catch(error=>{ console.error(error instanceof Error?error.message:"Demo seed failed."); process.exitCode=1; });
