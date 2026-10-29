import { chmodSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { connections, connect, checksums, authSummary, hash } from '../rehearsal/core';
import { snapshot, schemaDifferences } from '../demo/maintenance';
import { localDatabase } from '../demo/local-database';

const output=process.argv.find(arg=>arg.startsWith('--out='))?.slice(6);
async function main() {
  if(!output)throw new Error('Specify a new private --out=directory for inspection artifacts.');
  const dir=resolve(output);mkdirSync(dir,{mode:0o700});chmodSync(dir,0o700);
  const git=(...args:string[])=>execFileSync('git',args,{encoding:'utf8'}).trim();
  const files=readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort();
  const local=await localDatabase();
  let baseline:Record<string,unknown>={},target:Record<string,unknown>={};
  try {
    for(const file of files){await local.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
      if(file.startsWith('080_'))baseline=await snapshot(async q=>(await local.query(q)).rows as Record<string,unknown>[]);
    }
    target=await snapshot(async q=>(await local.query(q)).rows as Record<string,unknown>[]);
  }finally{await local.close();}
  const {source,target:development}=connections();
  const report:Record<string,any>={inspectedAt:new Date().toISOString(),releaseCommit:git('rev-parse','HEAD'),
    mainCommit:git('rev-parse','origin/main'),developCommit:git('rev-parse','origin/develop'),
    worktree:git('status','--porcelain'),migrations:files.map(file=>({file,sha256:hash(readFileSync(`supabase/migrations/${file}`))})),databases:{}};
  for(const [label,connection] of [['production',source],['development',development]] as const){
    const db=connect(connection.url,true);
    try {report.databases[label]=await db.begin('isolation level repeatable read read only',async tx=>{
      await tx`set local statement_timeout='60s'`;
      const schema=await snapshot(q=>tx.unsafe(q));
      const tables=new Set((schema.tables as {name:string}[]).map(t=>t.name));
      const history=(await tx`select to_regclass('supabase_migrations.schema_migrations') is not null present`)[0].present
        ?await tx`select version,name from supabase_migrations.schema_migrations order by version`:[];
      const configuration:Record<string,unknown>={};
      for(const table of ['organizations','organization_settings','programs','program_templates','program_template_modules','program_modules','module_catalog']) {
        if(tables.has(table))configuration[table]=await tx.unsafe(`select * from public."${table}"`);
      }
      const scope:Record<string,unknown>={};
      for(const table of ['seasons','sessions','payments','ledger_entries','session_player_charges','club_expenses','attendance','dropouts','goals','session_matches','session_team_players','session_teams','whatsapp_imports']){
        const columns=(schema.columns as {table_name:string;column_name:string}[]).filter(c=>c.table_name===table).map(c=>c.column_name);
        if(!columns.includes('program_id')){scope[table]={missingProgramColumn:true};continue;}
        scope[table]=await tx.unsafe(`select count(*) total,count(*) filter(where program_id is null) missing_program,
          count(*) filter(where program_id is not null and not exists(select 1 from public.programs p where p.id=t.program_id and p.organization_id=t.organization_id)) conflicting_program from public."${table}" t`);
      }
      return {projectRef:connection.ref,schema,history,configuration,scope,
        baselineDifferences:schemaDifferences(schema,baseline),targetDifferences:schemaDifferences(schema,target),
        protectedRows:await checksums(q=>tx.unsafe(q),true),accounts:await authSummary(q=>tx.unsafe(q)),
        tableGrants:await tx`select table_schema,table_name,grantee,privilege_type from information_schema.table_privileges where table_schema in ('public','storage') order by 1,2,3,4`,
        storagePolicies:await tx`select policyname,cmd,roles,qual,with_check from pg_policies where schemaname='storage' order by tablename,policyname`,
        storageBuckets:await tx`select id,public,file_size_limit,allowed_mime_types from storage.buckets order by id`,
        storageObjectCount:(await tx`select count(*) total from storage.objects`)[0].total};
    });}finally{await db.end({timeout:2});}
  }
  const prod=report.databases.production;
  report.candidateBatch=prod.baselineDifferences.length===0?files.filter(f=>Number(f.split('_')[0])>=81):[];
  report.blockers=[...(prod.baselineDifferences.length?['Production differs from the reviewed 080 baseline; no migration batch approved.']:[]),
    'Fresh isolated rehearsal and production-specific configuration review required.',
    'Production execution is not implemented or authorized by this inspection.'];
  writeFileSync(join(dir,'inspection.json'),JSON.stringify(report,null,2),{mode:0o600});
  console.log(JSON.stringify({directory:dir,releaseCommit:report.releaseCommit,
    productionBaselineDifferences:prod.baselineDifferences,developmentTargetDifferences:report.databases.development.targetDifferences,
    candidateBatch:report.candidateBatch,scope:prod.scope,blockers:report.blockers},null,2));
}
main().catch(error=>{console.error('Release inspection stopped:',error.code??'inspection failure; no credentials printed');process.exitCode=1;});
