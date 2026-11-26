import { beforeEach, expect, it, vi } from 'vitest';
const parser=vi.hoisted(()=>vi.fn());
const confirm=vi.hoisted(()=>vi.fn());
vi.mock('../actions/import-service',()=>({parseWhatsAppText:parser,confirmWhatsAppImport:confirm}));
import { processSignupRun, type SignupRun } from '../signup-import-service';
import type { ParsedWhatsAppImport } from '../types';
const raw='Please sign up\nDate: November 29, 2026\nPlayers\n1. Rafiul\n2. Guest';
const parsed: ParsedWhatsAppImport={rawText:raw,importType:'session_update',confidence:'high',parser:{engine:'llm',provider:'openai'},session:{date:'2026-11-29'},players:[{name:'Rafiul',confidence:'high'},{name:'Guest',confidence:'high'}],payments:[],attendance:[],dropouts:[],teams:[],matches:[],goals:[],warnings:[]};
const run={id:'run',organization_id:'org',configuration:{season_id:'season',program_id:'program',capacity:1,created_by:'actor'},target_date:'2026-11-29',window_from:'2026-11-24T02:00:00Z',window_until:'2026-11-27T01:00:00Z',claim_token:'claim',selections:{},manual:false} as SignupRun;
const message={id:'source',timestamp:Date.parse('2026-11-26T22:00:00Z')/1000,body:raw};
const tables: string[]=[];
const evidence: any[]=[];
let records: Record<string,unknown[]>;
const rpc=vi.fn();
function db() {
  return {from(table: string){tables.push(table);const q:any={select:()=>q,eq:()=>q,limit:()=>q,update:(value:unknown)=>{evidence.push(value);return q;},then:(resolve:Function)=>Promise.resolve({data:records[table]??[],error:null}).then(resolve as any)};return q;},rpc} as unknown as Parameters<typeof processSignupRun>[0];
}
beforeEach(()=>{
  tables.length=0;evidence.length=0;confirm.mockReset();confirm.mockResolvedValue({success:true});rpc.mockReset();rpc.mockResolvedValue({data:{id:'run',status:'imported'},error:null});parser.mockReset();parser.mockResolvedValue(structuredClone(parsed));
  records={players:[{id:'rafiul',display_name:'Rafiul'},{id:'guest',display_name:'Guest'}],player_aliases:[],whatsapp_imports:[{parsed_json:{players:[{matchedPlayerId:'rafiul'}]}}]};
});
it('delegates automatic confirmation and charging to the existing WhatsApp importer',async()=>{
  await processSignupRun(db(),run,[message],true);
  expect(parser).toHaveBeenCalledWith(raw);expect(confirm).toHaveBeenCalledTimes(1);
  const form=confirm.mock.calls[0][1] as FormData;
  expect(JSON.parse(String(form.get('parsedJson'))).attendance.map((row:any)=>row.status)).toEqual(['confirmed','waitlisted']);
  expect(form.get('signupRunId')).toBe(run.id);expect(confirm.mock.calls[0][2].automaticSignup).toBe(true);expect(rpc).not.toHaveBeenCalled();
});
it('unresolved names do not create sessions or attendance',async()=>{
  records.players=[{id:'rafiul',display_name:'Rafiul'}];
  expect((await processSignupRun(db(),run,[message],true)).status).toBe('needs_review');
  expect(confirm).not.toHaveBeenCalled();expect(tables).not.toContain('sessions');expect(tables).not.toContain('attendance');
});
it('requires review on parser fallback but allows a fully resolved Run now to import',async()=>{
  parser.mockResolvedValueOnce({...structuredClone(parsed),parser:{engine:'rule_based',provider:'openai',fallbackUsed:true}});
  expect((await processSignupRun(db(),run,[message],true)).status).toBe('needs_review');expect(confirm).not.toHaveBeenCalled();
  await processSignupRun(db(),{...run,manual:true},[message],true);expect(confirm).toHaveBeenCalledTimes(1);
});
it('surfaces shared importer errors without invoking a second database writer',async()=>{
  confirm.mockResolvedValueOnce({error:'Existing attendance requires review'});
  await expect(processSignupRun(db(),run,[message],true)).rejects.toThrow('Existing attendance');expect(rpc).not.toHaveBeenCalled();
});
it('accepts a valid latest signup before history reaches the opening time',async()=>{
  await processSignupRun(db(),run,[message],false,false,true);expect(confirm).toHaveBeenCalledTimes(1);
});
it('does not assume payment records imply season membership',async()=>{
  records.whatsapp_imports=[];
  await expect(processSignupRun(db(),run,[message],true)).rejects.toThrow('No confirmed season signup roster');expect(rpc).not.toHaveBeenCalled();
});

it('requests another history batch only when no matching signup was found',async()=>{
  const result=await processSignupRun(db(),run,[],false,false,true);
  expect(result.status).toBe('searching');expect(rpc).not.toHaveBeenCalled();expect(parser).not.toHaveBeenCalled();
});
it('sends exhausted history with no match to review',async()=>{
  await expect(processSignupRun(db(),run,[],false,false,false)).rejects.toThrow('No matching signup');expect(rpc).not.toHaveBeenCalled();
});
it('does not request more history or try an older list after the newest parser failure',async()=>{
  parser.mockRejectedValue(new Error('Parser unavailable'));
  await expect(processSignupRun(db(),run,[message,{...message,id:'older',timestamp:message.timestamp-100}],false,false,true)).rejects.toThrow('Parser unavailable');
  expect(parser).toHaveBeenCalledTimes(1);expect(rpc).not.toHaveBeenCalled();
});

it('parses and saves only the newest qualifying complete repost',async()=>{
  await processSignupRun(db(),run,[{...message,id:'older',timestamp:message.timestamp-100},message],false,false,true);
  expect(parser).toHaveBeenCalledTimes(1);expect(evidence.filter(update=>'incoming_messages' in update).at(-1).incoming_messages).toEqual([message]);
  expect(evidence.filter(update=>'incoming_messages' in update).every(update=>update.incoming_messages.length<=1)).toBe(true);
});
it('replaces legacy saved batches with only the failed newest candidate for review',async()=>{
  parser.mockRejectedValue(new Error('Parser unavailable'));
  await expect(processSignupRun(db(),{...run,incoming_messages:[{...message,id:'legacy-old'}]},[{...message,id:'older',timestamp:message.timestamp-100},message],false,false,true)).rejects.toThrow('Parser unavailable');
  expect(evidence[0].incoming_messages).toEqual([]);expect(evidence.filter(update=>'incoming_messages' in update).at(-1).incoming_messages).toEqual([message]);expect(parser).toHaveBeenCalledTimes(1);
});
