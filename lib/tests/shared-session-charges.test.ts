import { beforeEach,expect,it,vi } from 'vitest';
import { importMemoryDB } from './helpers/import-memory-db';
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('../program-access',()=>({requireEnabledProgramModule:vi.fn()}));
import { applySessionUsage } from '../actions/session-usage';
import { confirmWhatsAppImport } from '../actions/import-service';
let records:Record<string,any[]>;
const season='10000000-0000-4000-8000-000000000001',session='20000000-0000-4000-8000-000000000001';
beforeEach(()=>{
 records={players:[{id:'one',display_name:'Wali',organization_id:'org'},{id:'two',display_name:'Habib',organization_id:'org'}],player_aliases:[],seasons:[{id:season,organization_id:'org',program_id:'program'}],sessions:[{id:session,organization_id:'org',program_id:'program',season_id:season,session_date:'2099-11-29',status:'scheduled',price_per_session:13,seasons:{price_per_session:15}}],attendance:[{session_id:session,player_id:'one',status:'confirmed'},{session_id:session,player_id:'two',status:'waitlisted'}],session_player_charges:[],ledger_entries:[],audit_logs:[],whatsapp_imports:[],goals:[],playgrounds:[]};
});
async function usage(){return applySessionUsage({supabase:importMemoryDB(records) as any,sessionId:session,actorId:'admin',source:'whatsapp_import'});}
it('charges confirmed attendance and never waitlisted attendance, including repeat executions',async()=>{
 await usage();await usage();expect(records.session_player_charges).toHaveLength(1);expect(records.session_player_charges[0]).toMatchObject({player_id:'one',amount:13});expect(records.ledger_entries).toHaveLength(1);
});
it('repairs a charge whose ledger write was interrupted without double charging',async()=>{
 records.session_player_charges.push({id:'charge',session_id:session,player_id:'one',amount:13,source:'whatsapp_import',waiver_amount:0});
 await usage();await usage();expect(records.session_player_charges).toHaveLength(1);expect(records.ledger_entries).toHaveLength(1);expect(records.session_player_charges[0].ledger_entry_id).toBe(records.ledger_entries[0].id);
});
it('links an existing usage ledger after interruption without inserting another entry',async()=>{
 records.session_player_charges.push({id:'charge',session_id:session,player_id:'one',amount:13,source:'whatsapp_import'});records.ledger_entries.push({id:'ledger',session_id:session,player_id:'one',type:'session_used',amount:13});
 await usage();expect(records.ledger_entries).toHaveLength(1);expect(records.session_player_charges[0].ledger_entry_id).toBe('ledger');
});
it('preserves a confirmed player fee waiver',async()=>{
 records.session_player_charges.push({id:'charge',session_id:session,player_id:'one',amount:0,waiver_amount:13,ledger_entry_id:'ledger'});
 await usage();expect(records.session_player_charges[0].amount).toBe(0);expect(records.ledger_entries).toHaveLength(0);
});
it('promotion creates a charge and demotion removes only the standard imported fee',async()=>{
 await usage();records.attendance[1].status='confirmed';await usage();expect(records.session_player_charges).toHaveLength(2);
 records.attendance[1].status='waitlisted';await usage();expect(records.session_player_charges).toHaveLength(1);expect(records.ledger_entries).toHaveLength(1);
});
it('the actual manual confirmation path preserves raw waitlist entries and applies the same charges',async()=>{
 records.attendance=[];
 const raw='Date: November 29, 2099\nPlayers\n1. Wali\n*Waitlist (those who did not sign up for the season)*\n1. Habib';
 const form=new FormData();form.set('rawText',raw);form.set('seasonId',season);form.set('sessionId',session);form.set('createSessionDate','2099-11-29');form.set('createSessionPricePerSession','13');
 form.set('parsedJson',JSON.stringify({rawText:raw,importType:'session_update',confidence:'high',session:{date:'2099-11-29'},players:[{name:'Wali'},{name:'Habib'}],attendance:[{playerName:'Wali',status:'confirmed'},{playerName:'Habib',status:'confirmed'}],payments:[],teams:[],matches:[],goals:[],dropouts:[],warnings:[]}));
 form.set('match_Wali','one');form.set('match_Habib','two');
 const result=await confirmWhatsAppImport(null,form,{client:importMemoryDB(records) as any,profile:{id:'admin',role:'admin',organization_id:'org'},program:{id:'program'}});
 expect(result.error).toBeUndefined();expect(records.attendance.find(row=>row.player_id==='two').status).toBe('waitlisted');expect(records.session_player_charges.map(row=>row.player_id)).toEqual(['one']);
});

it('automatic signup calls the same confirmation path, applies allocation and charges exactly once',async()=>{
 const id='30000000-0000-4000-8000-000000000001';
 const run={id,organization_id:'org',schedule_id:'schedule',status:'reading',claim_token:'token',claimed_by:'instance',claim_until:new Date(Date.now()+600000).toISOString(),target_date:'2099-11-29',selections:{},configuration:{season_id:season,program_id:'program',capacity:1,updated_at:'revision'},session_id:null};
 records.attendance=[];records.signup_import_runs=[run];records.signup_import_schedules=[{id:'schedule',enabled:true,updated_at:'revision'}];records.message_worker_connections=[{id:'worker',organization_id:'org',instance_id:'instance',lease_until:new Date(Date.now()+600000).toISOString()}];
 records.whatsapp_imports=[{id:'prior-season',organization_id:'org',program_id:'program',season_id:season,status:'confirmed',parsed_json:{importType:'season_signup',players:[{matchedPlayerId:'two'}]}}];
 const raw='Date: November 29, 2099\nPlayers\n1. Wali\nWaitlist\n1. Habib';
 const form=new FormData();form.set('signupRunId',id);form.set('rawText',raw);form.set('seasonId',season);form.set('sessionId','__create__');form.set('parsedJson',JSON.stringify({rawText:raw,importType:'session_update',confidence:'high',session:{date:'2099-11-29',pricePerSession:13},players:[{name:'Wali'},{name:'Habib'}],attendance:[],payments:[],teams:[],matches:[],goals:[],dropouts:[],warnings:[]}));
 form.set('match_Wali','one');form.set('match_Habib','two');
 const context={client:importMemoryDB(records) as any,profile:{id:'admin',role:'admin' as const,organization_id:'org'},program:{id:'program'},automaticSignup:true,signupClaimToken:'token'};
 const result=await confirmWhatsAppImport(null,form,context);
 expect(result.error).toBeUndefined();expect(records.attendance.find(row=>row.player_id==='one').status).toBe('waitlisted');expect(records.attendance.find(row=>row.player_id==='two').status).toBe('confirmed');expect(records.session_player_charges.map(row=>row.player_id)).toEqual(['two']);expect(run.status).toBe('imported');
 await confirmWhatsAppImport(null,form,context);expect(records.session_player_charges).toHaveLength(1);expect(records.ledger_entries).toHaveLength(1);expect(records.whatsapp_imports.filter(row=>row.id===id)).toHaveLength(1);
});

function playgroundImport(selectedId?:string,sessionId='__create__') {
 const raw='Date: November 29, 2099\nPlayers\n1. Wali';
 const form=new FormData();
 for(const [key,value] of Object.entries({rawText:raw,seasonId:season,sessionId,createSessionDate:'2099-11-29',createSessionLocation:'Bell Sensplex',createSessionPricePerSession:'13',match_Wali:'one'}))form.set(key,value);
 if(selectedId)form.set('createSessionPlaygroundId',selectedId);
 form.set('parsedJson',JSON.stringify({rawText:raw,importType:'session_update',confidence:'high',session:{date:'2099-11-29',location:'Bell Sensplex'},players:[{name:'Wali'}],attendance:[{playerName:'Wali',status:'confirmed'}],payments:[],teams:[],matches:[],goals:[],dropouts:[],warnings:[]}));
 return confirmWhatsAppImport(null,form,{client:importMemoryDB(records) as any,profile:{id:'admin',role:'admin',organization_id:'org'},program:{id:'program'}});
}
it('saves the canonical existing playground and never inserts a playground',async()=>{
 records.playgrounds=[{id:'ground',name:'Bell Sensplex Stittsville',organization_id:'org'}];
 const result=await playgroundImport();expect(result.error).toBeUndefined();
 expect(records.sessions.at(-1)).toMatchObject({playground_id:'ground',location:'Bell Sensplex Stittsville'});expect(records.playgrounds).toHaveLength(1);
});
it('blocks ambiguous playgrounds and accepts an explicit scoped selection',async()=>{
 records.playgrounds=[{id:'ground',name:'Bell Sensplex',organization_id:'org'},{id:'east',name:'Bell Sensplex East',organization_id:'org'}];
 expect((await playgroundImport()).error).toContain('Multiple playgrounds match');expect(records.sessions).toHaveLength(1);
 expect((await playgroundImport('east')).error).toBeUndefined();expect(records.sessions.at(-1)).toMatchObject({playground_id:'east',location:'Bell Sensplex East'});
});
it('rejects a playground from another organization',async()=>{
 records.playgrounds=[{id:'foreign',name:'Bell Sensplex',organization_id:'other'}];
 expect((await playgroundImport('foreign')).error).toContain('unavailable in this organization');expect(records.sessions).toHaveLength(1);
});
it('preserves an assigned session playground unless explicitly changed',async()=>{
 records.sessions[0].playground_id='assigned';records.sessions[0].location='Existing venue';
 expect((await playgroundImport(undefined,session)).error).toBeUndefined();
 expect(records.sessions[0]).toMatchObject({playground_id:'assigned',location:'Existing venue'});
});
it('keeps unmatched locations as text without creating a playground',async()=>{
 expect((await playgroundImport()).error).toBeUndefined();expect(records.sessions.at(-1)).toMatchObject({playground_id:null,location:'Bell Sensplex'});expect(records.playgrounds).toHaveLength(0);
});
