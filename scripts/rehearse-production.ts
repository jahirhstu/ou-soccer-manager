import { chmodSync,existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { connections,connect,preflight,checksums,authSummary,hash,assertSame,quoteId } from './rehearsal/core';
import { snapshot,schemaDifferences } from './demo/maintenance';
import { localDatabase } from './demo/local-database';

const flags=process.argv.slice(3), action=process.argv[2];
const get=(name:string)=>flags.find(f=>f.startsWith(`--${name}=`))?.slice(name.length+3);
const bin=process.env.PG_BIN??'/usr/local/opt/libpq@17/bin';
let errorLog:string|undefined;
const save=(path:string,data:unknown)=>{writeFileSync(path,JSON.stringify(data,null,2),{mode:0o600});chmodSync(path,0o600);};
function rowAssertions(rows:Record<string,{count:string;hash:string}>) {
  return Object.entries(rows).map(([table,value])=>`do $check$ begin if
    (select count(*) from public.${quoteId(table)}) <> ${Number(value.count)} or
    (select md5(coalesce(string_agg(h,'' order by h),'')) from (select md5(to_jsonb(t)::text) h from public.${quoteId(table)} t) r) <> ${literal(value.hash)}
    then raise exception 'Snapshot mismatch in ${table.replaceAll("'","''")}'; end if; end $check$;`).join('\n');
}
function native(tool:string,args:string[],url?:string,readOnly=false) {
  const env={...process.env};
  if(url){const u=new URL(url);Object.assign(env,{PGHOST:u.hostname,PGPORT:u.port||'5432',PGDATABASE:decodeURIComponent(u.pathname.slice(1)),PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGSSLMODE:'require',PGCONNECT_TIMEOUT:'20',PGOPTIONS:readOnly?'-c default_transaction_read_only=on':''});}
  return new Promise<void>((ok,fail)=>{
    const child=spawn(join(bin,tool),args,{env,stdio:['ignore','ignore','pipe']});
    let error=''; child.stderr.on('data',b=>{error+=b.toString();});
    child.on('error',()=>fail(new Error(`${tool} could not start; check PG_BIN.`)));
    child.on('close',code=>{
      if(code===0){ok();return;}
      if(errorLog)writeFileSync(errorLog,error,{mode:0o600});
      fail(new Error(`${tool} failed (${code}); ${/permission denied/i.test(error)?'insufficient database permissions':/version mismatch/i.test(error)?'PostgreSQL version mismatch':'restore/export stopped'}. No credentials or row data printed. Details retained privately with the backup.`));
    });
  });
}
async function expectedSchema(maxVersion=Infinity) {
  const db=await localDatabase();
  try{for(const f of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')&&Number(f.split('_')[0])<=maxVersion).sort())await db.exec(readFileSync(`supabase/migrations/${f}`,'utf8'));
    return await snapshot(async q=>(await db.query(q)).rows as Record<string,unknown>[]);
  }finally{await db.close();}
}
async function exportDatabase(url:string,dir:string) {
  mkdirSync(dir,{recursive:true,mode:0o700});chmodSync(dir,0o700);
  const db=connect(url,true);
  try{return await db.begin('isolation level repeatable read read only',async tx=>{
    await preflight(q=>tx.unsafe(q));
    const id=(await tx`select pg_export_snapshot() id`)[0].id;
    const schema=await snapshot(q=>tx.unsafe(q));
    const rows=await checksums(q=>tx.unsafe(q));
    const protectedRows=await checksums(q=>tx.unsafe(q),true);
    const auth=await authSummary(q=>tx.unsafe(q));
    const customAuth=await tx`select pg_get_triggerdef(t.oid) definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace where n.nspname='auth' and not t.tgisinternal and pn.nspname='public'`;
    const realtime=await tx`select pubname,tablename from pg_publication_tables where schemaname='public' order by pubname,tablename`;
    const history=await tx`select version,name,statements from supabase_migrations.schema_migrations order by version`;
    const owners=await tx`select profile_id,organization_id from organization_members where role='owner' order by created_at`;
    const programs=await tx`select id,organization_id from programs where activity_type='soccer' and status='active'`;
    const authColumns=await tx`select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='auth' and table_name in ('users','identities') order by table_name,ordinal_position`;
    const extensions=await tx`select extname,extversion from pg_extension order by extname`;
    await native('pg_dump',['--format=custom','--schema=public','--no-owner','--no-publications',`--snapshot=${id}`,`--file=${join(dir,'application.dump')}`],url,true);
    await native('pg_dump',['--format=custom','--data-only','--table=auth.users','--table=auth.identities','--no-owner',`--snapshot=${id}`,`--file=${join(dir,'accounts.dump')}`],url,true);
    for(const file of ['application.dump','accounts.dump'])chmodSync(join(dir,file),0o600);
    const manifest={schema,rows,protectedRows,auth,customAuth,realtime,history,owners,programs,authColumns,extensions,
      files:Object.fromEntries(['application.dump','accounts.dump'].map(file=>[file,hash(readFileSync(join(dir,file)))]))};
    save(join(dir,'manifest.json'),manifest);return manifest;
  });}finally{await db.end({timeout:2});}
}
async function main() {
  if(!['preview','backup','restore-development','upgrade-development','recover-development','verify'].includes(action))throw new Error('Choose preview, backup, restore-development, upgrade-development, recover-development, or verify.');
  const {source,target}=connections();
  const execute=flags.includes('--execute');
  if(execute&&!flags.includes(`--confirm=${target.ref}`))throw new Error('Explicit development project confirmation required.');
  if(execute&&['restore-development','upgrade-development','recover-development'].includes(action)&&!flags.includes('--isolated'))throw new Error('Confirm stopped writers and outbound integrations with --isolated.');
  const root=resolve(get('run')??join(homedir(),'.local/share/ou-soccer-rehearsal',new Date().toISOString().replaceAll(':','-')));
  const db=connect(target.url);
  try {
    if(action==='preview') {
      const prod=connect(source.url,true);try {
        for(const [label,conn] of [['production',prod],['development',db]] as const)await conn.begin('read only',async t=>{await preflight(q=>t.unsafe(q));console.log(label,{schemaTables:(await t`select count(*) n from pg_tables where schemaname='public'`)[0].n,users:(await authSummary(q=>t.unsafe(q))).count});});
      }finally{await prod.end({timeout:2});}
      console.log({source:source.ref,target:target.ref,tooling:existsSync(join(bin,'pg_dump')),writes:false});return;
    }
    if(action==='backup') {
      if(!execute)throw new Error('Backup writes sensitive local files; use --execute and confirm the development project.');
      if(existsSync(root))throw new Error('Backup directory already exists; use a new run directory.');
      mkdirSync(root,{recursive:true,mode:0o700});
      errorLog=join(root,'native-error.private.log');
      console.log('Backing up existing development...');await exportDatabase(target.url,join(root,'development-before'));
      console.log('Exporting consistent production snapshot (read-only)...');const production=await exportDatabase(source.url,join(root,'production'));
      if(schemaDifferences(production.schema,await expectedSchema(80)).length)throw new Error('Production no longer matches the reviewed main baseline; stop for a new comparison.');
      save(join(root,'run.json'),{source:source.ref,target:target.ref,createdAt:new Date().toISOString(),status:'backed-up'});
      console.log('Backups complete:',root);return;
    }
    if(!get('run'))throw new Error('Specify the existing --run=BACKUP_DIRECTORY.');
    errorLog=join(root,'native-error.private.log');
    const state=JSON.parse(readFileSync(join(root,'run.json'),'utf8'));
    if(state.source!==source.ref||state.target!==target.ref)throw new Error('Project identifiers do not match this backup.');
    const recovery=action==='recover-development';
    const sourceFolder=recovery||(action!=='restore-development'&&state.status==='recovered')?'development-before':'production';
    const baseline=JSON.parse(readFileSync(join(root,sourceFolder,'manifest.json'),'utf8'));
    if(action==='restore-development'||recovery) {
      if(!recovery&&!['backed-up','recovered'].includes(state.status))throw new Error('Restore requires a fresh backup or verified recovery; create another backup before replacing changed data.');
      if(recovery&&!execute){console.log('Preview: recover the original development backup; current development data will first be backed up separately.');return;}
      if(recovery&&!flags.includes('--recovery-confirmed'))throw new Error('Recovery replaces current test data; add --recovery-confirmed.');
      const before=recovery?await exportDatabase(target.url,join(root,`before-recovery-${Date.now()}`)):JSON.parse(readFileSync(join(root,'development-before/manifest.json'),'utf8'));
      for(const folder of ['production','development-before']) {
        const manifest=JSON.parse(readFileSync(join(root,folder,'manifest.json'),'utf8'));
        for(const [file,digest] of Object.entries(manifest.files))assertSame(hash(readFileSync(join(root,folder,file))),digest,'Backup checksum');
      }
      await db.begin('read only',async tx=>{
        await preflight(q=>tx.unsafe(q));
        assertSame(await checksums(q=>tx.unsafe(q)),before.rows,'Development changed since backup');
        assertSame(await authSummary(q=>tx.unsafe(q)),before.auth,'Development accounts changed since backup');
        if(schemaDifferences(await snapshot(q=>tx.unsafe(q)),before.schema).length)throw new Error('Development schema changed since backup.');
        const columns=await tx`select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='auth' and table_name in ('users','identities') order by table_name,ordinal_position`;
        assertSame(columns,baseline.authColumns,'Managed Auth table compatibility');
      });
      console.log({action,target:target.ref,execute,sourceUsers:baseline.auth.count});if(!execute)return;
      const archive=join(root,sourceFolder,'application.dump');
      const listing=spawnSync(join(bin,'pg_restore'),['--list',archive],{encoding:'utf8'});
      if(listing.status!==0)throw new Error('Could not inspect archive contents.');
      // Supabase reserves its managed role. Existing object grants are retained.
      const entries=listing.stdout.split('\n').filter(line=>!/^\d+;.* DEFAULT ACL public DEFAULT PRIVILEGES FOR (TABLES|FUNCTIONS|SEQUENCES) supabase_admin$/.test(line));
      writeFileSync(join(root,'application.list'),entries.join('\n'),{mode:0o600});
      await native('pg_restore',['--no-owner',`--use-list=${join(root,'application.list')}`,`--file=${join(root,'application.sql')}`,archive]);
      await native('pg_restore',['--no-owner',`--file=${join(root,'accounts.sql')}`,join(root,sourceFolder,'accounts.dump')]);
      const history=baseline.history.map((r:any)=>`insert into supabase_migrations.schema_migrations(version,name,statements) values (${literal(r.version)},${literal(r.name)},array[${(r.statements??[]).map(literal).join(',')}]::text[]);`).join('\n');
      const restore=["set local lock_timeout='10s'; set local statement_timeout='120s';",
        `lock table ${Object.keys(before.rows).map(t=>`public.${quoteId(t)}`).join(',')} in access exclusive mode;`,rowAssertions(before.rows),
        'drop schema public cascade; delete from auth.users;',
        "set local session_replication_role=replica;",readFileSync(join(root,'accounts.sql'),'utf8'),
        readFileSync(join(root,'application.sql'),'utf8'),"set local session_replication_role=origin; set local search_path=public;",
        ...baseline.customAuth.map((r:any)=>r.definition+';'),
        'delete from supabase_migrations.schema_migrations;',history,
        ...baseline.realtime.map((r:any)=>`alter publication ${quoteId(r.pubname)} add table public.${quoteId(r.tablename)};`),
        "update auth.users set confirmation_token='',recovery_token='',email_change_token_new='',email_change_token_current='',phone_change_token='',reauthentication_token='';",
        rowAssertions(baseline.rows),
        `do $check$ begin if (select count(*) from auth.users) <> ${Number(baseline.auth.count)} or
          (select md5(coalesce(string_agg(md5(id::text||coalesce(email,'')||coalesce(encrypted_password,'')),'' order by id),'')) from auth.users) <> ${literal(baseline.auth.hash)}
          then raise exception 'Auth identity/password hash mismatch'; end if; end $check$;`
      ].join('\n');
      writeFileSync(join(root,'restore.sql'),restore,{mode:0o600});
      for(const f of ['application.sql','accounts.sql'])chmodSync(join(root,f),0o600);
      await native('psql',['-X','--single-transaction','--set=ON_ERROR_STOP=1',`--file=${join(root,'restore.sql')}`],target.url);
      await db.begin('read only',async tx=>{
        assertSame(await checksums(q=>tx.unsafe(q)),baseline.rows,'Restored application rows');
        assertSame(await authSummary(q=>tx.unsafe(q)),baseline.auth,'Restored accounts/password hashes');
        const differences=schemaDifferences(await snapshot(q=>tx.unsafe(q)),baseline.schema);
        if(differences.length)throw new Error('Restored schema differs: '+differences.join('; '));
      });
      save(join(root,'run.json'),{...state,status:recovery?'recovered':'restored'});console.log(recovery?'Original development backup recovered and verified.':'Production baseline restored and verified in development.');return;
    }
    if(action==='upgrade-development') {
      if(state.status!=='restored')throw new Error('A verified production baseline must be restored first.');
      if(baseline.owners.length!==1||baseline.programs.length!==1||baseline.owners[0].organization_id!==baseline.programs[0].organization_id)throw new Error('Bootstrap identity selection is no longer unambiguous.');
      console.log({action,target:target.ref,execute});if(!execute)return;
      const expected=await expectedSchema();
      await db.begin(async tx=>{
        await tx`set local lock_timeout='10s'`;
        assertSame(await checksums(q=>tx.unsafe(q)),baseline.rows,'Baseline modified before upgrade');
        for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()) {
          if(Number(file.split('_')[0])>=81)await tx.unsafe(readFileSync(`supabase/migrations/${file}`,'utf8'));
        }
        await tx`select set_config('rehearsal.organization_id',${baseline.owners[0].organization_id},true),set_config('rehearsal.program_id',${baseline.programs[0].id},true),set_config('rehearsal.owner_id',${baseline.owners[0].profile_id},true)`;
        await tx.unsafe(readFileSync('scripts/production/configure-existing-club.sql','utf8'));
        assertSame(await checksums(q=>tx.unsafe(q),true),baseline.protectedRows,'Protected historical data');
        assertSame(await authSummary(q=>tx.unsafe(q)),baseline.auth,'Auth accounts');
        const differences=schemaDifferences(await snapshot(q=>tx.unsafe(q)),expected);
        if(differences.length)throw new Error('Upgraded schema differs: '+differences.join('; '));
        if((await tx`select version from supabase_migrations.schema_migrations`).length)throw new Error('Expected the inspected empty migration history.');
        for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()) {
          const [version,...name]=file.replace(/\.sql$/,'').split('_');
          await tx`insert into supabase_migrations.schema_migrations(version,name,statements) values(${version},${name.join('_')},${tx.array([readFileSync(`supabase/migrations/${file}`,'utf8')])})`;
        }
      });
      save(join(root,'run.json'),{...state,status:'upgraded'});console.log('Upgrade committed; historical data and Auth hashes unchanged.');return;
    }
    if(action==='verify') {
      const expected=state.status==='upgraded'?await expectedSchema():baseline.schema;
      await db.begin('read only',async tx=>{
        const differences=schemaDifferences(await snapshot(q=>tx.unsafe(q)),expected);
        if(differences.length)throw new Error(differences.join('; '));
        assertSame(await checksums(q=>tx.unsafe(q),true),baseline.protectedRows,'Protected historical data');
        assertSame(await authSummary(q=>tx.unsafe(q)),baseline.auth,'Auth identity/password hashes');
      });
      console.log('Schema, protected historical data, and account hashes verified.');
    }
  }finally{await db.end({timeout:2});}
}
function literal(v:string|null){return v===null?'null':"'"+v.replaceAll("'","''")+"'";}
main().catch(e=>{console.error(e.code?`Database operation stopped (${e.code}); no sensitive details printed.`:e.message);process.exitCode=1;});
