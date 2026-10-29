import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { parseEnv } from 'node:util';
import { authSummary, checksums, connect, hash, project } from '../rehearsal/core';
import { snapshot } from '../demo/maintenance';

async function main() {
  const env=parseEnv(readFileSync('.env.production.local','utf8'));
  const source=project(env.PRODUCTION_DATABASE_URL!,env.PRODUCTION_SUPABASE_URL!);
  if(!process.argv.includes(`--confirm=${source.ref}`))throw new Error('Confirm the production project for read-only backup.');
  const root=join(homedir(),'.local/share/ou-production-releases');
  mkdirSync(root,{recursive:true,mode:0o700});
  const dir=join(root,new Date().toISOString().replaceAll(':','-'));
  mkdirSync(dir,{mode:0o700});
  const url=new URL(source.url), bin=process.env.PG_BIN??'/usr/local/opt/libpq@17/bin';
  const childEnv={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',
    PGDATABASE:decodeURIComponent(url.pathname.slice(1)),PGUSER:decodeURIComponent(url.username),
    PGPASSWORD:decodeURIComponent(url.password),PGSSLMODE:'require',PGCONNECT_TIMEOUT:'20',
    PGOPTIONS:'-c default_transaction_read_only=on'};
  async function run(tool:string,args:string[]) {
    await new Promise<void>((resolve,reject)=>{
      const child=spawn(join(bin,tool),args,{env:childEnv,stdio:['ignore','ignore','pipe']});
      let error='';child.stderr.on('data',chunk=>{error+=chunk.toString();});
      child.on('error',()=>reject(new Error(`${tool} could not start`)));
      child.on('close',code=>{if(code===0)resolve();else{
        writeFileSync(join(dir,'error.private.log'),error,{mode:0o600});reject(new Error(`${tool} failed; private error log retained`));
      }});
    });
  }
  const db=connect(source.url,true);
  try {
    await db.begin('isolation level repeatable read read only',async tx=>{
      const id=(await tx`select pg_export_snapshot() id`)[0].id;
      const manifest={projectRef:source.ref,createdAt:new Date().toISOString(),
        schema:await snapshot(q=>tx.unsafe(q)),rows:await checksums(q=>tx.unsafe(q)),
        protectedRows:await checksums(q=>tx.unsafe(q),true),accounts:await authSummary(q=>tx.unsafe(q)),
        storageObjects:(await tx`select count(*) total from storage.objects`)[0].total,
        history:await tx`select * from supabase_migrations.schema_migrations order by version`};
      const archive=join(dir,'database.dump');
      await run('pg_dump',['--format=custom','--no-owner',`--snapshot=${id}`,`--file=${archive}`]);
      chmodSync(archive,0o600);
      await run('pg_restore',['--list',archive]);
      // Decode the archive fully without executing SQL; listing alone does not check data blocks.
      await run('pg_restore',['--file=/dev/null',archive]);
      writeFileSync(join(dir,'manifest.json'),JSON.stringify({...manifest,sha256:hash(readFileSync(archive)),
        verification:'Archive listed and decoded; restore not rehearsed. Storage object bytes are not part of pg_dump.'},null,2),{mode:0o600});
    });
    console.log(JSON.stringify({backupDirectory:dir,projectRef:source.ref,databaseWrites:false,
      verification:'Full database archive listed and decoded; no restore rehearsal performed.'},null,2));
  } finally {await db.end({timeout:2});}
}
main().catch(error=>{console.error('Production backup stopped:',error.code??error.message);process.exitCode=1;});
