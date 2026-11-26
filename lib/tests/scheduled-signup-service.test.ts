import { beforeEach, expect, it, vi } from 'vitest';
const parser=vi.hoisted(()=>vi.fn());
vi.mock('../actions/import-service',()=>({parseWhatsAppText:parser}));
import { processSignupRun, type SignupRun } from '../signup-import-service';
import type { ParsedWhatsAppImport } from '../types';
const raw='Please sign up\nDate: November 29, 2026\nPlayers\n1. Rafiul\n2. Guest';
const parsed: ParsedWhatsAppImport={rawText:raw,importType:'session_update',confidence:'high',parser:{engine:'llm',provider:'openai'},session:{date:'2026-11-29'},players:[{name:'Rafiul',confidence:'high'},{name:'Guest',confidence:'high'}],payments:[],attendance:[],dropouts:[],teams:[],matches:[],goals:[],warnings:[]};
const run={id:'run',organization_id:'org',configuration:{season_id:'season',program_id:'program',capacity:1},target_date:'2026-11-29',window_from:'2026-11-24T02:00:00Z',window_until:'2026-11-27T01:00:00Z',claim_token:'claim',selections:{},manual:false} as SignupRun;
const message={id:'source',timestamp:Date.parse('2026-11-26T22:00:00Z')/1000,body:raw};
const tables: string[]=[];
let records: Record<string,unknown[]>;
const rpc=vi.fn();
function db() {
  return {from(table: string){tables.push(table);const q:any={select:()=>q,eq:()=>q,limit:()=>q,then:(resolve:Function)=>Promise.resolve({data:records[table]??[],error:null}).then(resolve as any)};return q;},rpc} as unknown as Parameters<typeof processSignupRun>[0];
}
beforeEach(()=>{
  tables.length=0;rpc.mockReset();rpc.mockResolvedValue({data:{id:'run',status:'imported'},error:null});parser.mockReset();parser.mockResolvedValue(structuredClone(parsed));
  records={players:[{id:'rafiul',display_name:'Rafiul'},{id:'guest',display_name:'Guest'}],player_aliases:[],whatsapp_imports:[{parsed_json:{players:[{matchedPlayerId:'rafiul'}]}}]};
});
it('uses the existing parser and applies membership allocation without writing payments',async()=>{
  await processSignupRun(db(),run,[message],true);
  expect(parser).toHaveBeenCalledWith(raw);
  const args=rpc.mock.calls[0][1];expect(args.p_finalize).toBe(true);
  expect(args.p_payload.draft.rows.map((r:any)=>r.status)).toEqual(['confirmed','waitlisted']);
  expect(tables).toEqual(['players','player_aliases','whatsapp_imports']);
});
it('saves an unresolved draft instead of finalizing attendance',async()=>{
  records.players=[{id:'rafiul',display_name:'Rafiul'}];
  await processSignupRun(db(),run,[message],true);
  expect(rpc.mock.calls[0][1].p_finalize).toBe(false);expect(rpc.mock.calls[0][1].p_payload.draft.needs_review).toBe(true);
});
it('requires review for parser fallback and for every manual reread',async()=>{
  parser.mockResolvedValueOnce({...structuredClone(parsed),parser:{engine:'rule_based',provider:'openai',fallbackUsed:true}});
  await processSignupRun(db(),run,[message],true);expect(rpc.mock.calls[0][1].p_finalize).toBe(false);
  await processSignupRun(db(),{...run,manual:true},[message],true);expect(rpc.mock.calls[1][1].p_finalize).toBe(false);
});
it('prepares the draft if existing attendance prevents automatic finalization',async()=>{
  rpc.mockResolvedValueOnce({error:{message:'Session contains manual attendance'},data:null});
  await processSignupRun(db(),run,[message],true);
  expect(rpc).toHaveBeenCalledTimes(2);expect(rpc.mock.calls[1][1].p_finalize).toBe(false);expect(rpc.mock.calls[1][1].p_payload.error).toContain('manual attendance');
});
it('rejects incomplete history before parsing or database mutations',async()=>{
  await expect(processSignupRun(db(),run,[message],false)).rejects.toThrow('history');expect(parser).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();
});
it('does not assume payment records imply season membership',async()=>{
  records.whatsapp_imports=[];
  await expect(processSignupRun(db(),run,[message],true)).rejects.toThrow('No confirmed season signup roster');expect(rpc).not.toHaveBeenCalled();
});

it('lets an administrator reparse a saved draft without depending on a live worker lease',async()=>{
  await processSignupRun(db(),{...run,manual:true},[message],true,true);
  expect(rpc.mock.calls[0][1].p_review).toBe(true);expect(rpc.mock.calls[0][1].p_finalize).toBe(false);
});
