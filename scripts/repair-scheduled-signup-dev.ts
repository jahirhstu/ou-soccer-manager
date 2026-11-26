/** Scoped development repair. Default is a read-only preview; --apply migrates and reconciles fees. */
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {parseEnv} from 'node:util';
import postgres from 'postgres';
import {createClient} from '@supabase/supabase-js';
import {applySessionUsage} from '../lib/actions/session-usage';
const ref='vnmloamscqaqmagimfmz',organizationId='bc8032b0-1ce1-4f2c-93d1-df439a815274';
async function main(){
 const apply=process.argv.includes('--apply'),env=parseEnv(readFileSync('.env.local','utf8'));
 const target=new URL(env.DATABASE_URL!);
 if(env.NEXT_PUBLIC_SUPABASE_URL!==`https://${ref}.supabase.co` || (target.hostname!==`db.${ref}.supabase.co`&&decodeURIComponent(target.username)!==`postgres.${ref}`))throw new Error('Development target mismatch');
 const db=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SECRET_KEY??env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
 const runs=await db.from('signup_import_runs').select('id,session_id,configuration,updated_at').eq('organization_id',organizationId).eq('status','imported').order('updated_at',{ascending:false}).limit(1000);
 if(runs.error)throw new Error(runs.error.message);if((runs.data?.length??0)>=1000)throw new Error('Run scope exceeds the safe repair limit');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const work:Array<{sessionId:string;actorId:string}>=[];const seen=new Set<string>();
 for(const run of runs.data??[]){
  if(!run.session_id||seen.has(run.session_id))continue;seen.add(run.session_id);
  const session=await db.from('sessions').select('id,status,session_date,organization_id,program_id,price_per_session,seasons(price_per_session)').eq('id',run.session_id).eq('organization_id',organizationId).single();
  if(session.error)throw new Error(session.error.message);
  if(session.data.status!=='scheduled'||session.data.session_date<today)continue;
  if(session.data.program_id!==run.configuration.program_id)throw new Error('Session program mismatch');
  const actorId=run.configuration.created_by;if(!actorId)throw new Error('Imported run has no audit actor');
  if(Number(session.data.price_per_session??(session.data.seasons as any)?.price_per_session??0)<=0)throw new Error('Session price needs manual review before fee repair');
  work.push({sessionId:run.session_id,actorId});
 }
 console.log(JSON.stringify({environment:'development',organizationId,finalizedFutureSessions:work.length,apply}));
 if(!apply){
  for(const item of work){
   const [attendance,charges,session,report]=await Promise.all([db.from('attendance').select('player_id,status').eq('session_id',item.sessionId),db.from('session_player_charges').select('player_id,amount').eq('session_id',item.sessionId),db.from('sessions').select('season_id').eq('id',item.sessionId).single(),db.rpc('public_player_report')]);
   for(const result of [attendance,charges,session,report])if(result.error)throw new Error(result.error.message);
   const waiting=new Set(attendance.data?.filter(row=>row.status==='waitlisted').map(row=>row.player_id));
   const rows=(report.data??[]).filter((row:any)=>row.season_id===session.data?.season_id&&waiting.has(row.player_id));
   console.log(JSON.stringify({sessionId:item.sessionId,confirmedPlayers:attendance.data?.filter(row=>row.status==='confirmed').length,waitlistedPlayers:waiting.size,chargeCount:charges.data?.length,totalCharges:charges.data?.reduce((sum,row)=>sum+Number(row.amount),0),waitlistChargeCount:charges.data?.filter(row=>waiting.has(row.player_id)).length,publicWaitlistRows:rows.map((row:any)=>({confirmed:Number(row.confirmed_sessions),waitlisted:Number(row.waitlisted_sessions),upcomingConfirmed:row.upcoming_session,upcomingWaitlisted:row.upcoming_waitlisted_session}))}));
  }
  return;
 }
 // Do not remove the old writer until the replacement website is serving requests.
 const config=JSON.parse(readFileSync(join(process.env.OU_WHATSAPP_HOME??join(homedir(),'Library/Application Support/OU Soccer WhatsApp'),'config.json'),'utf8'));
 const developmentApp='https://ou-soccer-manager-git-develop-jahirhstu.vercel.app';
 if(!['https://ou-soccer-manager.vercel.app',developmentApp].includes(new URL(config.app_url).origin))throw new Error('Unexpected app origin for the private Vercel bypass credential');
 let ready=false;
 for(let attempt=0;attempt<12;attempt++){
  try{
   const response=await fetch(`${developmentApp}/api/worker/signup-import`,{headers:config.vercel_bypass_secret?{'x-vercel-protection-bypass':config.vercel_bypass_secret}:{},redirect:'error',signal:AbortSignal.timeout(10000)});
   if(response.ok&&(await response.json()).pipeline==='shared-whatsapp-v1'){ready=true;break;}
  }catch{ /* Only the fixed readiness result is logged; credentials and response bodies stay private. */ }
  if(attempt===0)console.log('Waiting for the shared development importer deployment.');
  await new Promise(resolve=>setTimeout(resolve,5000));
 }
 if(!ready)throw new Error('Deploy the updated development importer before applying this repair');
 const sql=postgres(env.DATABASE_URL!,{max:1,prepare:false,ssl:'require',connect_timeout:15,onnotice:()=>{}});
 try{
  await sql.begin(async tx=>{
   for(const file of ['116_shared_signup_import.sql','117_waitlisted_public_status.sql']){
    const source=readFileSync(`supabase/migrations/${file}`,'utf8'),[version,...name]=file.replace(/\.sql$/,'').split('_');
    const existing=await tx`select name from supabase_migrations.schema_migrations where version=${version}`;
    if(existing.length){if(existing[0].name!==name.join('_'))throw new Error('Migration history mismatch');continue;}
    await tx.unsafe(source);
    await tx`insert into supabase_migrations.schema_migrations(version,name,statements) values(${version},${name.join('_')},${tx.array([source])})`;
   }
  });
 }finally{await sql.end();}
 for(const item of work){
  const result=await applySessionUsage({supabase:db as any,sessionId:item.sessionId,actorId:item.actorId,source:'whatsapp_import'});
  console.log(JSON.stringify({sessionId:item.sessionId,...result}));
  const [attendance,charges]=await Promise.all([db.from('attendance').select('player_id,status').eq('session_id',item.sessionId),db.from('session_player_charges').select('player_id,ledger_entry_id').eq('session_id',item.sessionId)]);
  if(attendance.error||charges.error)throw new Error('Repair verification unavailable');
  const waiting=new Set(attendance.data?.filter(row=>row.status==='waitlisted').map(row=>row.player_id));
  if(charges.data?.some(charge=>waiting.has(charge.player_id)||!charge.ledger_entry_id))throw new Error('Fee repair requires manual review');
 }
 const report=await db.rpc('public_player_report');if(report.error)throw new Error(report.error.message);
 console.log('Development migration and finalized-session fee reconciliation verified. Drafts and production were not changed.');
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Development repair failed');process.exitCode=1;});
