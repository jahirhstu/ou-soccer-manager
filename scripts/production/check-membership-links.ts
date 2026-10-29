import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { connect,project } from '../rehearsal/core';
async function main(){
  const env=parseEnv(readFileSync('.env.production.local','utf8'));
  const source=project(env.PRODUCTION_DATABASE_URL!,env.PRODUCTION_SUPABASE_URL!);
  const db=connect(source.url,true);
  try{await db.begin('read only',async tx=>{
    const rows=await tx`select om.organization_id,om.player_id,p.display_name as player_name,
      om.profile_id,pr.display_name as account_name,om.role as organization_role,
      pm.id as program_membership_id,pm.player_id as program_player_id,pm.role as program_role
      from public.organization_members om join public.players p on p.id=om.player_id
      join public.profiles pr on pr.id=om.profile_id
      left join public.program_members pm on pm.profile_id=om.profile_id and pm.organization_id=om.organization_id
      where exists(select 1 from public.organization_members duplicate where duplicate.organization_id=om.organization_id
        and duplicate.player_id=om.player_id and duplicate.profile_id<>om.profile_id)
      order by om.player_id,om.profile_id`;
    console.log(JSON.stringify(rows,null,2));
  });}finally{await db.end({timeout:2});}
}
main().catch(error=>{console.error('Read-only link inspection failed',error.code??'unknown');process.exitCode=1;});
