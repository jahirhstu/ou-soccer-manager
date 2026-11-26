import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({from:vi.fn(),authority:vi.fn(),module:vi.fn(),revalidate:vi.fn(),process:vi.fn()}));
vi.mock('../supabase/server',()=>({getCurrentProfile:async()=>({id:'admin',organization_id:'org'}),createSupabaseServerClient:async()=>({})}));
vi.mock('../supabase/admin',()=>({createSupabaseAdminClient:()=>({from:mocks.from})}));
vi.mock('../organization-access',()=>({requireOrganizationAdminAuthority:mocks.authority}));
vi.mock('../program-access',()=>({requireEnabledProgramModule:mocks.module}));
vi.mock('../signup-import-service',()=>({prepareSignupDraft:vi.fn(),saveSignupDraft:vi.fn(),processSignupRun:mocks.process}));
vi.mock('next/cache',()=>({revalidatePath:mocks.revalidate}));
import { signupImportMutation } from '../actions/signup-import';
const id='10000000-0000-4000-8000-000000000001';
const schedule={id,organization_id:'org',program_id:'program',season_id:'season',destination_id:'group',timezone:'America/Toronto',session_weekday:7,opening_weekday:1,opening_time:'21:00:00',capacity:21,enabled:true};
let available=true,active=false;
const inserts: Record<string,any>[]=[];
const filters: Array<[string,string,unknown]>=[];
beforeEach(()=>{
  vi.clearAllMocks();vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-25T18:00:00Z'));available=true;active=false;inserts.length=0;filters.length=0;
  mocks.authority.mockResolvedValue(undefined);mocks.module.mockResolvedValue(undefined);
  mocks.from.mockImplementation((table:string)=>{
    const q:any={select:()=>q,eq:(key:string,value:unknown)=>{filters.push([table,key,value]);return q;},in:()=>q,limit:()=>q,
      single:async()=>({data:available?schedule:null,error:available?null:{message:'not found'}}),
      maybeSingle:async()=>({data:active?{id:'existing'}:null,error:null}),
      insert:async(value:Record<string,any>)=>{inserts.push(value);return {error:null};}};
    return q;
  });
});
afterEach(()=>{vi.useRealTimers();});
it('queues a first manual import using now and the configured upcoming session date',async()=>{
  expect(await signupImportMutation('run_now',{id})).toEqual({success:true});
  expect(inserts).toHaveLength(1);expect(inserts[0]).toMatchObject({organization_id:'org',schedule_id:id,manual:true,scheduled_at:'2026-11-25T18:00:00.000Z',target_date:'2026-11-29',window_from:'2026-11-24T02:00:00Z',window_until:'2026-11-25T18:00:00Z'});
  expect(filters).toContainEqual(['signup_import_schedules','organization_id','org']);expect(filters).toContainEqual(['signup_import_schedules','enabled',true]);
  expect(mocks.module).toHaveBeenCalledWith({},'org','program','whatsapp_import');
});
it('rejects a disabled or unavailable schedule without creating a run',async()=>{
  available=false;expect((await signupImportMutation('run_now',{id})).error).toContain('Enable the schedule');expect(inserts).toHaveLength(0);
});
it('does not queue another request while the schedule already has an active run',async()=>{
  active=true;expect((await signupImportMutation('run_now',{id})).error).toContain('already has a queued');expect(inserts).toHaveLength(0);
});
it('requires organization administrator authority before using the worker queue',async()=>{
  mocks.authority.mockRejectedValue(new Error('Administrator required'));
  expect((await signupImportMutation('run_now',{id})).error).toBe('Administrator required');expect(mocks.from).not.toHaveBeenCalled();
});

it('removes the custom review actions in favor of the WhatsApp import page',async()=>{
  const result=await signupImportMutation('retry_parse',{id});
  expect(result.error).toBeDefined();expect(mocks.process).not.toHaveBeenCalled();
});
