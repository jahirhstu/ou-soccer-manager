import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ user: vi.fn(), rpc: vi.fn(), from: vi.fn(), parse: vi.fn(), confirm: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getUser: mocks.user }, rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("../supabase/env", () => ({ getSupabaseEnv: () => ({ url: "https://test.invalid", publishableKey: "public" }) }));
vi.mock("../actions/import-service", () => ({ parseWhatsAppAction: mocks.parse, confirmWhatsAppImport: mocks.confirm }));
import { POST } from "../../app/api/mobile/whatsapp/route";
const programId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function request(body: unknown, authenticated=true) {
  return new NextRequest("https://development.invalid/api/mobile/whatsapp",{method:"POST",headers:{"Content-Type":"application/json",...(authenticated?{Authorization:"Bearer test-token"}:{})},body:JSON.stringify(body)});
}
beforeEach(()=>{
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({data:{user:{id:"actor"}},error:null});
  mocks.rpc.mockImplementation(async(name:string)=>({data:name==="program_role"?"manager":true,error:null}));
  mocks.from.mockReturnValue({select:()=>({eq:()=>({single:async()=>({data:{id:programId,organization_id:"org"},error:null})})})});
  mocks.parse.mockResolvedValue({parsed:{players:[]}});
  mocks.confirm.mockResolvedValue({success:true});
});
it("rejects requests without authentication before invoking import services",async()=>{
  expect((await POST(request({action:"parse",programId,rawText:"hello"},false))).status).toBe(401);
  expect(mocks.parse).not.toHaveBeenCalled();
});
it.each(["captain","member"])("rejects %s imports",async(role)=>{
  mocks.rpc.mockImplementation(async(name:string)=>({data:name==="program_role"?role:true,error:null}));
  expect((await POST(request({action:"parse",programId,rawText:"hello"}))).status).toBe(403);
  expect(mocks.parse).not.toHaveBeenCalled();
});
it("rejects disabled modules",async()=>{
  mocks.rpc.mockImplementation(async(name:string)=>({data:name==="program_role"?"manager":name!=="is_program_module_enabled",error:null}));
  expect((await POST(request({action:"parse",programId,rawText:"hello"}))).status).toBe(403);
});
it("passes verified identity and program to the shared parser",async()=>{
  expect((await POST(request({action:"parse",programId,rawText:"hello"}))).status).toBe(200);
  expect(mocks.parse.mock.calls[0][2]).toMatchObject({profile:{id:"actor",organization_id:"org",role:"admin"},program:{id:programId}});
});
it("rejects unselected names before confirmation",async()=>{
  expect((await POST(request({action:"confirm",programId,rawText:"hello",seasonId:"season",parsed:{players:[{name:"Ronnie"}]},matches:{}}))).status).toBe(400);
  expect(mocks.confirm).not.toHaveBeenCalled();
});
it("does not accept a user-supplied profile or organization as authorization",async()=>{
  await POST(request({action:"parse",programId,rawText:"hello",profile:{id:"victim",role:"admin",organization_id:"foreign"}}));
  expect(mocks.parse.mock.calls[0][2].profile.id).toBe("actor");
  expect(mocks.parse.mock.calls[0][2].profile.organization_id).toBe("org");
});
