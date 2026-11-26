import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),parse:vi.fn(),cookiesClient:vi.fn(),from:vi.fn()}));
vi.mock('../supabase/admin',()=>({createSupabaseAdminClient:()=>({rpc:mocks.rpc,from:mocks.from})}));
vi.mock('../actions/import-service',()=>({parseWhatsAppText:mocks.parse}));
vi.mock('@supabase/ssr',()=>({createServerClient:mocks.cookiesClient}));
import { middleware } from '../../middleware';
import { POST } from '../../app/api/worker/signup-import/route';
beforeEach(()=>{vi.clearAllMocks();});
const credentials={worker_id:'10000000-0000-4000-8000-000000000001',instance_id:'20000000-0000-4000-8000-000000000001',token:'a'.repeat(64)};
it('routes worker requests to endpoint authentication without redirecting to browser login',async()=>{
  const response=await middleware(new NextRequest('https://app.example.com/api/worker/signup-import'));
  expect(response.headers.get('x-middleware-next')).toBe('1');expect(mocks.cookiesClient).not.toHaveBeenCalled();
});
it('rejects invalid worker credentials before parsing group messages',async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:{message:'Invalid worker credential'}});
  const result=await POST(new Request('https://app.example.com/api/worker/signup-import',{method:'POST',body:JSON.stringify({...credentials,action:'poll',ready:true})}));
  expect(result.status).toBe(401);expect(mocks.parse).not.toHaveBeenCalled();
});
it('rejects malformed and oversized payloads without looking up worker credentials',async()=>{
  const malformed=await POST(new Request('https://app.example.com/api/worker/signup-import',{method:'POST',body:'{}'}));
  expect(malformed.status).toBe(400);
  const oversized=await POST(new Request('https://app.example.com/api/worker/signup-import',{method:'POST',headers:{'content-length':'2000001'},body:'{}'}));
  expect(oversized.status).toBe(413);expect(mocks.rpc).not.toHaveBeenCalled();
});

function claimedRun() {
  return {id:'30000000-0000-4000-8000-000000000001',organization_id:'org',claimed_by:credentials.instance_id,claim_token:'40000000-0000-4000-8000-000000000001',claim_until:new Date(Date.now()+600000).toISOString(),status:'reading',target_date:'2026-11-29',window_from:'2026-11-24T02:00:00Z',window_until:'2026-11-27T01:00:00Z',incoming_messages:[{id:'earlier-batch',timestamp:1,body:'Signup\n1. Other'}]};
}
function mockRun(row: ReturnType<typeof claimedRun>) {
  const updates: any[]=[];
  mocks.rpc.mockResolvedValue({data:'org',error:null});
  mocks.from.mockImplementation(()=>{
    const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:row,error:null}),update:(value:any)=>{updates.push(value);return q;},then:(resolve:any)=>Promise.resolve({error:null}).then(resolve)};
    return q;
  });
  return updates;
}
it('keeps the claim reading and retains earlier evidence when requesting the next batch',async()=>{
  const row=claimedRun(),updates=mockRun(row);
  const result=await POST(new Request('https://app.example.com/api/worker/signup-import',{method:'POST',body:JSON.stringify({...credentials,action:'submit',run_id:row.id,claim_token:row.claim_token,messages:[],history_complete:false,batch_final:false})}));
  expect(await result.json()).toMatchObject({status:'searching'});expect(updates).toHaveLength(1);expect(updates[0].incoming_messages).toEqual(row.incoming_messages);expect(updates[0].status).toBeUndefined();
});
it('marks the newest signup parse failure for review instead of requesting another batch',async()=>{
  const row=claimedRun(),updates=mockRun(row);mocks.parse.mockRejectedValue(new Error('Parser unavailable'));
  const result=await POST(new Request('https://app.example.com/api/worker/signup-import',{method:'POST',body:JSON.stringify({...credentials,action:'submit',run_id:row.id,claim_token:row.claim_token,messages:[{id:'latest',timestamp:Date.parse('2026-11-26T22:00:00Z')/1000,body:'Signup\nDate: November 29, 2026\n1. Rafiul'}],history_complete:false,batch_final:false})}));
  expect(await result.json()).toMatchObject({status:'needs_review'});expect(updates[0].incoming_messages).toHaveLength(2);expect(updates[1]).toMatchObject({status:'needs_review',error:'Parser unavailable'});expect(mocks.parse).toHaveBeenCalledTimes(1);
});
