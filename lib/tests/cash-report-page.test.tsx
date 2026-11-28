import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, it, expect, vi } from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),program:vi.fn()}));
vi.mock('../../app/(shell)',()=>({AppShell:({children}:any)=><main>{children}</main>}));
vi.mock('next/link',()=>({default:({children,...props}:any)=><a {...props}>{children}</a>}));
vi.mock('@/lib/tenant-server',()=>({getScopedPath:async(path:string)=>`/o/club/p/soccer${path}`}));
vi.mock('@/lib/supabase/server',()=>({getCurrentProgram:mocks.program,createSupabaseServerClient:async()=>({rpc:mocks.rpc,from:()=>{const q:any={select:()=>q,eq:()=>q,order:async()=>({data:[],error:null})};return q;}})}));
import Page from '../../app/reports/finances/page';
import {GET} from '../../app/reports/finances/export/route';
const report={opening:500,money_in:200,money_out:300,closing:400,count:26,page:2,rows:[{id:'payment:x',number:26,date:'2026-11-02',particulars:'Expense — Tea',description:'Food',season:'Fall',money_in:0,money_out:300,balance:400}]};
beforeEach(()=>{mocks.program.mockResolvedValue({id:'program',name:'Soccer'});mocks.rpc.mockResolvedValue({data:report,error:null});});
describe('financial report page and export',()=>{
 it('renders balances, descriptions and scoped pagination',async()=>{const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({from:'2026-11-01',to:'2026-11-30',page:'2'})}));expect(html).toContain('Opening Cash Balance');expect(html).toContain('$500.00');expect(html).toContain('$400.00');expect(html).toContain('positive balance does not necessarily mean profit');expect(html).toContain('Showing 26–26 of 26');expect(html).toContain('/o/club/p/soccer/reports/finances/export?');expect(html).toContain('page=1');expect(mocks.rpc).toHaveBeenCalledWith('admin_club_cash_report',expect.objectContaining({p_program_id:'program',p_page:2,p_page_size:25}));});
 it('shows invalid ranges without calling the report',async()=>{mocks.rpc.mockClear();const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({from:'2026-12-01',to:'2026-11-01'})}));expect(html).toContain('role="alert"');expect(mocks.rpc).not.toHaveBeenCalled();});
 it('marks negative cash clearly',async()=>{mocks.rpc.mockResolvedValue({data:{...report,closing:-30},error:null});const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}));expect(html).toContain('Deficit');expect(html).toContain('-$30.00');});
 it('exports through the same authorized RPC without pagination',async()=>{const response=await GET(new Request('http://localhost/reports/finances/export?from=2026-11-01&to=2026-11-30&page=2'));expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('private, no-store');expect(mocks.rpc).toHaveBeenCalledWith('admin_club_cash_report',expect.objectContaining({p_page:1,p_page_size:null}));expect(await response.text()).toContain('Closing Cash Balance,,200,300,400');});
 it('does not export data when authorization fails',async()=>{mocks.rpc.mockResolvedValue({data:null,error:{message:'Only an authorized program manager can view cash reports'}});const response=await GET(new Request('http://localhost/reports/finances/export'));expect(response.status).toBe(400);expect(await response.text()).toContain('authorized program manager');});
});
