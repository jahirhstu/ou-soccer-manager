import { readFileSync,readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { expect,it } from 'vitest';
import { localDatabase } from '../../scripts/demo/local-database';
import { snapshot,schemaDifferences } from '../../scripts/demo/maintenance';
import { attributionLinks } from '../../scripts/demo/schema';
import { accounts,buildDemoDataset,demoId,type AccountIds } from '../../scripts/demo/dataset';

it('upgrades the old development architecture, cleans all app data, and reseeds',async()=>{
  const db=await localDatabase(),fresh=await localDatabase();
  try {
    const files=execFileSync('git',['ls-tree','--name-only','8a10cb1','supabase/migrations/'],{encoding:'utf8'}).trim().split('\n');
    for(const file of files) await db.exec(execFileSync('git',['show',`8a10cb1:${file}`],{encoding:'utf8'}));
    for(const [table,column] of attributionLinks) await db.exec(`alter table ${table} drop constraint ${table}_${column}_fkey`);
    await db.exec(`alter table players add column avatar_url text; alter table session_teams add column score integer;
      alter table sessions add column team_a_score integer,add column team_b_score integer;
      drop function public.submit_payment_sent_notification(uuid,uuid);`);
    for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()) await fresh.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
    const target=await snapshot(async q=>(await fresh.query(q)).rows as Record<string,unknown>[]);
    await db.exec('begin');
    await db.exec(readFileSync('scripts/generated/dev-upgrade.sql','utf8'));
    expect(schemaDifferences(await snapshot(async q=>(await db.query(q)).rows as Record<string,unknown>[]),target)).toEqual([]);
    await db.exec('commit');
    await db.exec('begin');
    await db.exec(readFileSync('scripts/generated/dev-cleanup.sql','utf8'));
    await db.exec('commit');
    const ids=Object.fromEntries(accounts.map(key=>[key,demoId(`account:${key}`)])) as AccountIds;
    for(const key of accounts) await db.query('insert into auth.users(id,email) values ($1,$2)',[ids[key],`${key}@demo.example.test`]);
    await db.exec('begin');
    await db.exec(buildDemoDataset(ids,'2026-10-24').sql);
    await db.exec('commit');
    expect((await db.query<{n:number}>('select count(*)::int n from sessions')).rows[0].n).toBe(144);
    await db.exec('begin');
    await db.exec(readFileSync('scripts/generated/dev-cleanup.sql','utf8'));
    expect((await db.query<{n:number}>('select count(*)::int n from players')).rows[0].n).toBe(0);
    expect((await db.query<{n:number}>('select count(*)::int n from profiles')).rows[0].n).toBe(0);
    await db.exec('rollback');
  } finally {await db.close();await fresh.close();}
},120000);
