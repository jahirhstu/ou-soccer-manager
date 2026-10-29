import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { project, connect, checksums, authSummary, assertSame, hash, quoteId } from '../rehearsal/core';
import { snapshot, schemaDifferences } from '../demo/maintenance';
import { localDatabase } from '../demo/local-database';

const rollback=new Error('VERIFIED_ROLLBACK');
async function main(){
  const args=process.argv.slice(2),commit=args.includes('--commit');
  const dir=resolve(args.find(a=>a.startsWith('--backup='))?.slice(9)??'');
  if(!args.some(a=>a.startsWith('--backup='))||!args.includes('--maintenance'))throw new Error('Backup and confirmed maintenance required.');
  const env=parseEnv(readFileSync('.env.production.local','utf8'));
  const source=project(env.PRODUCTION_DATABASE_URL!,env.PRODUCTION_SUPABASE_URL!);
  if(source.ref!=='uqntqbcimkyoiptvtrem'||!args.includes(`--confirm=${source.ref}`))throw new Error('Production project confirmation mismatch.');
  const backup=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8'));
  if(backup.projectRef!==source.ref||hash(readFileSync(join(dir,'database.dump')))!==backup.sha256)throw new Error('Backup integrity mismatch.');
  if(Date.now()-new Date(backup.createdAt).getTime()>24*60*60*1000)throw new Error('Backup is older than 24 hours.');
  const files=readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort();
  const manifest=files.map(file=>({file,sha256:hash(readFileSync(`supabase/migrations/${file}`))}));
  const configuration=readFileSync('scripts/production/configure-release.sql','utf8');
  const release={commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),manifest,configurationHash:hash(configuration),runnerHash:hash(readFileSync('scripts/production/migrate-release.ts'))};
  if(commit){const proof=JSON.parse(readFileSync(join(dir,'verified-rollback.json'),'utf8'));assertSame(proof.release,release,'Release changed since rollback verification');}
  const local=await localDatabase();let baseline:Record<string,unknown>={},expected:Record<string,unknown>={};
  try{for(const file of files){await local.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));if(file.startsWith('080_'))baseline=await snapshot(async q=>(await local.query(q)).rows as Record<string,unknown>[]);}
    expected=await snapshot(async q=>(await local.query(q)).rows as Record<string,unknown>[]);
  }finally{await local.close();}
  const db=connect(source.url);let result:Record<string,unknown>={};
  try {
    try {await db.begin(async tx=>{
      await tx`set local lock_timeout='10s'`;await tx`set local statement_timeout='120s'`;
      await tx.unsafe(`lock table ${Object.keys(backup.rows).map(t=>`public.${quoteId(t)}`).join(',')},auth.users,auth.identities in access exclusive mode`);
      assertSame(await checksums(q=>tx.unsafe(q)),backup.rows,'Production changed since backup');
      assertSame(await authSummary(q=>tx.unsafe(q)),backup.accounts,'Accounts changed since backup');
      const beforeSchema=await snapshot(q=>tx.unsafe(q));
      if(schemaDifferences(beforeSchema,baseline).length)throw new Error('Production no longer matches baseline 080');
      if((await tx`select version from supabase_migrations.schema_migrations`).length)throw new Error('Unexpected migration history; review required');
      const owners=await tx`select profile_id,organization_id from public.organization_members where role='owner'`;
      const programs=await tx`select id,organization_id from public.programs where status='active'`;
      if(owners.length!==1||programs.length!==1||owners[0].organization_id!==programs[0].organization_id)throw new Error('Ambiguous owner/program configuration');
      const org=owners[0].organization_id,program=programs[0].id;
      await tx`select set_config('request.jwt.claim.sub',${owners[0].profile_id},true)`;
      const finances=async()=>({
        dashboards:[...await tx`select s.id,f.* from public.seasons s cross join lateral public.admin_dashboard_season_finance(s.id) f order by s.id`],
        balances:[...await tx`select count(*)::text count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by s.player_id,s.season_id),'')) hash from public.player_season_payment_summary s`]});
      const beforeFinance=await finances();
      const identityHash=async()=>[...await tx`select count(*)::text count,md5(coalesce(string_agg(md5(to_jsonb(i)::text),'' order by id),'')) hash from auth.identities i`];
      const identities=await identityHash();
      const members=await tx`select * from public.program_members order by id`;
      const links=async()=>({profiles:[...await tx`select id,player_id from public.profiles order by id`],organizations:[...await tx`select id,profile_id,player_id,role from public.organization_members order by id`]});
      const originalLinks=await links();
      const settings=await tx`select to_jsonb(s) as value from public.organization_settings s where organization_id=${org}`;
      const oldPublic=await tx`select public_reports_enabled from public.organizations where id=${org}`;
      for(const file of files.filter(f=>Number(f.split('_')[0])>=81)){
        console.log('Applying within transaction:',file);await tx.unsafe(readFileSync(`supabase/migrations/${file}`,'utf8'));
      }
      await tx`select set_config('release.organization_id',${org},true),set_config('release.program_id',${program},true)`;
      await tx.unsafe(configuration);
      // Before 081, an enabled public report exposed both balances and paid amounts.
      await tx`update public.organization_settings set public_balances_enabled=${oldPublic[0].public_reports_enabled},public_payments_enabled=${oldPublic[0].public_reports_enabled} where organization_id=${org}`;
      // Carry existing captain authority into the new program-scoped authorization.
      await tx`update public.program_members pm set role='captain' from public.organization_members om
        where pm.profile_id=om.profile_id and pm.organization_id=om.organization_id and pm.program_id=${program}
        and om.organization_id=${org} and om.role='captain' and om.status='active' and pm.status='active' and pm.role='member'`;
      await tx`insert into public.module_catalog(key,name) values('leagues','Leagues') on conflict(key) do nothing`;
      await tx`insert into public.program_template_modules(program_template_id,module_key,default_enabled,required)
        select program_template_id,'leagues',true,false from public.programs where id=${program} on conflict do nothing`;
      await tx`insert into public.program_modules(organization_id,program_id,module_key,enabled)
        select ${org},${program},module_key,true from unnest(array['whatsapp_import','public_reports','leagues']) module_key on conflict(program_id,module_key) do nothing`;
      assertSame(await checksums(q=>tx.unsafe(q),true),backup.protectedRows,'Historical data');
      assertSame(await authSummary(q=>tx.unsafe(q)),backup.accounts,'Accounts');assertSame(await identityHash(),identities,'Auth identities');
      const afterMembers=await tx`select * from public.program_members order by id`;
      assertSame(await links(),originalLinks,'Existing profile and organization player links');
      for(const old of members){const current=afterMembers.find(m=>m.id===old.id);if(!current||current.player_id!==old.player_id||current.profile_id!==old.profile_id||current.status!==(old.status??'active'))throw new Error('Existing membership identity/status changed');}
      const currentSettings=(await tx`select to_jsonb(s) value from public.organization_settings s where organization_id=${org}`)[0].value;
      for(const [key,value] of Object.entries(settings[0].value)){if(key!=='updated_at')assertSame(currentSettings[key],value,`Existing setting ${key}`);}
      assertSame(await finances(),beforeFinance,'Financial reconciliation');
      const differences=schemaDifferences(await snapshot(q=>tx.unsafe(q)),expected);
      if(differences.length)throw new Error('Target schema mismatch: '+differences.join('; '));
      for(const table of ['payments','ledger_entries','attendance','dropouts','goals','session_matches','session_team_players','session_teams','whatsapp_imports']){
        const parent=['attendance','dropouts','goals','session_matches','session_team_players','session_teams'].includes(table)?'sessions':'seasons';
        const key=parent==='sessions'?'session_id':'season_id';
        const invalid=await tx.unsafe(`select count(*)::int n from public.${quoteId(table)} c join public.${parent} p on p.id=c.${key} where c.program_id is distinct from p.program_id or c.organization_id is distinct from p.organization_id`);
        if(invalid[0].n)throw new Error(`Unresolved parent scope: ${table}`);
      }
      for(const file of files){const [version,...name]=file.replace(/\.sql$/,'').split('_');await tx`insert into supabase_migrations.schema_migrations(version,name,statements) values(${version},${name.join('_')},${tx.array([readFileSync(`supabase/migrations/${file}`,'utf8')])})`;}
      result={release,projectRef:source.ref,verifiedAt:new Date().toISOString(),finances:beforeFinance,membershipCount:afterMembers.length,committed:commit};
      if(!commit)throw rollback;
    });}catch(error){if(error!==rollback){writeFileSync(join(dir,'migration-error.private.json'),JSON.stringify({message:(error as Error).message,code:(error as {code?:string}).code},null,2),{mode:0o600});throw error;}}
    writeFileSync(join(dir,commit?'migration-committed.json':'verified-rollback.json'),JSON.stringify(result,null,2),{mode:0o600});
    console.log(commit?'Migration committed; historical data, accounts and financial balances verified.':'Migration verified and rolled back; no changes committed.');
  }finally{await db.end({timeout:2});}
}
main().catch(error=>{console.error(error.code?`Migration transaction stopped (${error.code}); no sensitive details printed.`:error.message);process.exitCode=1;});
