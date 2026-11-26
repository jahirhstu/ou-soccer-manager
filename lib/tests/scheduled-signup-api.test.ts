import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),parse:vi.fn(),cookiesClient:vi.fn()}));
vi.mock('../supabase/admin',()=>({createSupabaseAdminClient:()=>({rpc:mocks.rpc})}));
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
