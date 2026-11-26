import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach,expect,it,vi } from 'vitest';
import { importMemoryDB } from './helpers/import-memory-db';
const mocks=vi.hoisted(()=>({db:null as any,parse:vi.fn()}));
vi.mock('../supabase/server',()=>({createSupabaseServerClient:async()=>mocks.db,getCurrentProfile:async()=>({id:'admin',role:'admin',organization_id:'org'}),getCurrentProgram:async()=>({id:'program'})}));
vi.mock('../tenant-server',()=>({getRequestTenantSlug:async()=>'club',getRequestProgramSlug:async()=>'soccer'}));
vi.mock('../parsers',()=>({whatsappParser:{parse:mocks.parse}}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('../../app/(shell)',()=>({AppShell:({children}:any)=><main>{children}</main>}));
import ImportPage from '../../app/import-whatsapp/page';
import { SignupImports } from '../../components/SignupImports';
const id='30000000-0000-4000-8000-000000000001';
const raw='Date: November 29, 2099\nPlayers\n1. Wali\nWaitlist\n1. Habib';
let records:Record<string,any[]>;
beforeEach(()=>{
 records={signup_import_runs:[{id,organization_id:'org',status:'needs_review',target_date:'2099-11-29',window_from:'2099-11-24T02:00:00Z',window_until:'2099-11-27T01:00:00Z',configuration:{season_id:'season',program_id:'program',capacity:1},source_message:{id:'source',body:raw},selections:{}}],players:[{id:'one',display_name:'Wali',organization_id:'org'},{id:'two',display_name:'Habib',organization_id:'org'}],player_aliases:[],whatsapp_imports:[{season_id:'season',organization_id:'org',program_id:'program',status:'confirmed',parsed_json:{importType:'season_signup',players:[{matchedPlayerId:'two'}]}}],seasons:[{id:'season',name:'Fall'}],sessions:[],playgrounds:[],ledger_entries:[],attendance:[],session_player_charges:[]};
 mocks.db={...importMemoryDB(records),rpc:async()=>({data:[],error:null})};
 mocks.parse.mockReset();mocks.parse.mockResolvedValue({rawText:raw,importType:'session_update',confidence:'high',session:{date:'2099-11-29'},players:[{name:'Wali'},{name:'Habib'}],attendance:[],warnings:[],payments:[],goals:[],teams:[],matches:[],dropouts:[]});
});
it('opens the existing page with text prefilled, parsed, and allocated without importing',async()=>{
 const before=JSON.stringify(records);
 const html=renderToStaticMarkup(await ImportPage({searchParams:Promise.resolve({signupRun:id})}));
 expect(mocks.parse).toHaveBeenCalledWith(raw);expect(html).toContain('Habib: confirmed');expect(html).toContain('Wali: waitlisted');expect(html).toContain('Recalculate signup allocation');expect(html).toContain(`name="signupRunId" value="${id}"`);expect(JSON.stringify(records)).toBe(before);
});
it('rejects another program run before parsing its message',async()=>{
 records.signup_import_runs[0].configuration.program_id='other-program';
 await expect(ImportPage({searchParams:Promise.resolve({signupRun:id})})).rejects.toThrow('unavailable');expect(mocks.parse).not.toHaveBeenCalled();
});
it('renders a run link and removes the separate review/finalize section',()=>{
 const href=`/club/soccer/import-whatsapp?signupRun=${id}`;
 const html=renderToStaticMarkup(<SignupImports initial={{schedules:[],runs:records.signup_import_runs,seasons:[],destinations:[],players:[],reviewLinks:{[id]:href}} as any}/>);
 expect(html).toContain(href);expect(html).toContain('View / review in WhatsApp import');expect(html).not.toContain('Finalize attendance');expect(html).not.toContain('Signup roster review');
});

it('keeps the saved text editable when parsing fails instead of losing the review page',async()=>{
 mocks.parse.mockRejectedValue(new Error('Parser unavailable'));
 const html=renderToStaticMarkup(await ImportPage({searchParams:Promise.resolve({signupRun:id})}));
 expect(html).toContain('Parser unavailable');expect(html).toContain('1. Wali');expect(html).toContain('Parse draft');expect(records.sessions).toHaveLength(0);
});

it('preserves explicit ignores when the prepared roster omits that name',async()=>{
 records.signup_import_runs[0].selections={Wali:'__ignore__'};
 const html=renderToStaticMarkup(await ImportPage({searchParams:Promise.resolve({signupRun:id})}));
 expect(html).toContain('name="match_Wali" value="__ignore__"');expect(html).toContain('Habib: confirmed');
});

function impactRow(html:string,name:string) {return [...html.matchAll(/<tr>[\s\S]*?<\/tr>/g)].map(match=>match[0]).find(row=>row.includes(name))??'';}
it('previews a charge for a new session before the session record exists and uses its parsed price',async()=>{
 records.seasons[0].price_per_session=12;
 mocks.parse.mockResolvedValueOnce({...await mocks.parse(),session:{date:'2099-11-29',pricePerSession:13}});
 const html=renderToStaticMarkup(await ImportPage({searchParams:Promise.resolve({signupRun:id})}));
 expect(impactRow(html,'Habib')).toContain('Charge added');expect(impactRow(html,'Habib')).toContain('-$13.00');expect(impactRow(html,'Wali')).toContain('No balance change');expect(impactRow(html,'Wali')).not.toContain('-$13.00');expect(records.sessions).toHaveLength(0);
});
it('does not hide a missing charge merely because existing attendance is already confirmed',async()=>{
 records.signup_import_runs[0].session_id='existing';
 records.sessions=[{id:'existing',season_id:'season',session_date:'2099-11-29',name:'November 29th',price_per_session:13}];
 records.attendance=[{session_id:'existing',player_id:'two',status:'confirmed'}];
 const html=renderToStaticMarkup(await ImportPage({searchParams:Promise.resolve({signupRun:id})}));
 expect(impactRow(html,'Habib')).toContain('Charge added');expect(impactRow(html,'Habib')).toContain('-$13.00');
});
it('shows no additional charge when a fee already exists',async()=>{
 records.signup_import_runs[0].session_id='existing';records.sessions=[{id:'existing',season_id:'season',session_date:'2099-11-29',name:'November 29th',price_per_session:13}];
 records.session_player_charges=[{session_id:'existing',player_id:'two',amount:13}];
 const html=renderToStaticMarkup(await ImportPage({searchParams:Promise.resolve({signupRun:id})}));
 expect(impactRow(html,'Habib')).toContain('No balance change');expect(impactRow(html,'Habib')).not.toContain('Charge added');
});
