import { readFileSync,readdirSync } from 'node:fs';
import { expect,it } from 'vitest';
import { localDatabase } from '../../scripts/demo/local-database';
import { checksums,assertSame,project } from '../../scripts/rehearsal/core';

it('rejects a database URL for a different project',()=>{
  expect(()=>project('postgresql://postgres.wrong:secret@pooler.example:5432/postgres','https://expected.supabase.co')).toThrow('mismatch');
});
it('backfills old records and preserves identity links and financial values',async()=>{
  const db=await localDatabase();
  const id=(n:number)=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const org=id(1),program=id(2),owner=id(3),captain=id(4),other=id(5),player=id(6),season=id(7),session=id(8);
  const files=readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort();
  try {
    for(const f of files.filter(f=>Number(f.split('_')[0])<=80))await db.exec(readFileSync(`supabase/migrations/${f}`,'utf8'));
    await db.exec(`insert into auth.users(id,email) values('${owner}','owner@test.local'),('${captain}','captain@test.local'),('${other}','other@test.local');
      insert into organizations(id,name,slug) values('${org}','Existing Club','existing-club');
      insert into organization_settings(organization_id) values('${org}');
      insert into programs(id,organization_id,name,slug,activity_type) values('${program}','${org}','Soccer','soccer','soccer');
      insert into players(id,organization_id,display_name) values('${player}','${org}','Existing Player');
      insert into organization_members(organization_id,profile_id,role,player_id) values
        ('${org}','${owner}','owner',null),('${org}','${captain}','captain','${player}'),('${org}','${other}','player','${player}');
      insert into program_members(organization_id,program_id,profile_id,player_id,role) values('${org}','${program}','${captain}','${player}','member');
      insert into seasons(id,organization_id,program_id,name,price_per_session) values('${season}','${org}','${program}','Existing Season',12);
      insert into sessions(id,organization_id,program_id,season_id,session_date,status) values('${session}','${org}','${program}','${season}','2026-01-01','completed');
      insert into attendance(organization_id,program_id,session_id,player_id,status) values('${org}',null,'${session}','${player}','played');
      insert into payments(organization_id,program_id,season_id,player_id,amount) values('${org}',null,'${season}','${player}',100);
      insert into ledger_entries(organization_id,program_id,season_id,player_id,type,amount) values('${org}',null,'${season}','${player}','payment_received',100);`);
    const before=await checksums(async q=>(await db.query(q)).rows as Record<string,unknown>[],true);
    await db.exec('begin');
    for(const f of files.filter(f=>Number(f.split('_')[0])>=81))await db.exec(readFileSync(`supabase/migrations/${f}`,'utf8'));
    await db.exec(`select set_config('rehearsal.organization_id','${org}',true),set_config('rehearsal.program_id','${program}',true),set_config('rehearsal.owner_id','${owner}',true);`);
    await db.exec(readFileSync('scripts/production/configure-existing-club.sql','utf8'));
    assertSame(await checksums(async q=>(await db.query(q)).rows as Record<string,unknown>[],true),before,'Historical data');
    expect((await db.query<{program_id:string}>('select program_id from payments')).rows[0].program_id).toBe(program);
    const rows=(await db.query<{profile_id:string;player_id:string|null;role:string}>('select profile_id,player_id,role from program_members where program_id=$1',[program])).rows;
    expect(rows.find(r=>r.profile_id===captain)).toMatchObject({role:'captain',player_id:player});
    expect(rows.find(r=>r.profile_id===other)).toMatchObject({role:'member',player_id:null});
    await db.exec('rollback');
    expect((await db.query<{program_id:string|null}>('select program_id from payments')).rows[0].program_id).toBeNull();
  }finally{await db.close();}
},60000);
