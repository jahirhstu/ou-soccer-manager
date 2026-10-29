import { it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

it('preserves existing links and adds ambiguous accounts without choosing a player owner',async()=>{
  const db=new PGlite();
  const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
  try{
    await db.exec(`
      create table organizations(id uuid primary key,is_default boolean default false);
      create table programs(id uuid primary key,organization_id uuid,status text,is_default boolean default false);
      create table profiles(id uuid primary key,player_id uuid,default_organization_id uuid,default_program_id uuid);
      create table organization_members(organization_id uuid,profile_id uuid,player_id uuid,role text,status text);
      create table program_members(organization_id uuid,program_id uuid,profile_id uuid,player_id uuid,role text,status text,
        unique(program_id,profile_id),unique(program_id,player_id));
      create table development_refresh_targets(enabled boolean);
      insert into organizations(id) values('${id(1)}');
      insert into programs(id,organization_id,status) values('${id(2)}','${id(1)}','active');
    `);
    for(const [profile,player] of [[10,100],[11,100],[12,200],[13,200],[14,300]]){
      await db.query('insert into profiles(id,player_id) values($1,$2)',[id(profile),id(player)]);
      await db.query("insert into organization_members values($1,$2,$3,'player','active')",[id(1),id(profile),id(player)]);
    }
    await db.query("insert into program_members values($1,$2,$3,$4,'member','active')",[id(1),id(2),id(10),id(100)]);
    const before=(await db.query('select id,player_id from profiles order by id')).rows;
    await db.exec('begin');
    await db.query("select set_config('release.organization_id',$1,true),set_config('release.program_id',$2,true)",[id(1),id(2)]);
    const sql=readFileSync('scripts/production/configure-release.sql','utf8');
    await db.exec(sql);await db.exec(sql);
    const rows=(await db.query<{profile_id:string;player_id:string|null}>('select profile_id,player_id from program_members order by profile_id')).rows;
    expect(rows).toEqual([{profile_id:id(10),player_id:id(100)},{profile_id:id(11),player_id:null},{profile_id:id(12),player_id:null},{profile_id:id(13),player_id:null},{profile_id:id(14),player_id:id(300)}]);
    expect((await db.query('select id,player_id from profiles order by id')).rows).toEqual(before);
    expect((await db.query('select * from organization_members')).rows).toHaveLength(5);
    await db.exec('rollback');
  }finally{await db.close();}
},20000);
