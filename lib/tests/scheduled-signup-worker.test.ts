import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { SignupImportWorker } from '../../apps/whatsapp-worker/src/signup-import';
import type { WhatsAppProvider } from '../../apps/whatsapp-worker/src/provider';
const config = { supabase_url:'https://db.example.com', publishable_key:'public',worker_id:'worker',token:'private',app_url:'https://app.example.com' };
const work={ id:'run',claim_token:'claim',group_id:'soccer@g.us',from:'2026-11-24T02:00:00Z',until:'2026-11-27T01:00:00Z' };
const fetcher=vi.fn();
beforeEach(()=>{vi.stubGlobal('fetch',fetcher);fetcher.mockReset();});afterEach(()=>{vi.unstubAllGlobals();});
function response(data: unknown) { return { ok:true,headers:new Headers({'content-type':'application/json'}),json:async()=>data }; }
it('polls and submits likely signup messages to the app without forwarding chatter',async()=>{
  const ready=vi.fn(async()=>true),history=vi.fn(async()=>({complete:true,messages:[{id:'signup',timestamp:1,body:'Signup\n1. Rafiul'}, {id:'chat',timestamp:2,body:'Hello everyone'}]}));
  fetcher.mockResolvedValueOnce(response({schedules:[],runs:[work]})).mockResolvedValueOnce(response({status:'needs_review'}));
  const worker=new SignupImportWorker(config,'instance',{ready,history} as unknown as WhatsAppProvider);
  await worker.tick(vi.fn());
  expect(history).toHaveBeenCalledWith(work.group_id,work.from,work.until,100);
  const body=JSON.parse(fetcher.mock.calls[1][1].body);expect(body.messages).toHaveLength(1);expect(body.messages[0].id).toBe('signup');expect(body.history_complete).toBe(true);
  expect(fetcher.mock.calls[1][0]).toBe('https://app.example.com/api/worker/signup-import');
});
it('reports incomplete history instead of importing a potentially stale list',async()=>{
  const provider={ready:async()=>true,history:async()=>({complete:false,messages:[]})};
  fetcher.mockResolvedValueOnce(response({schedules:[],runs:[work]})).mockResolvedValueOnce(response({status:'needs_review'}));
  await new SignupImportWorker(config,'instance',provider as unknown as WhatsAppProvider).tick(vi.fn());
  expect(JSON.parse(fetcher.mock.calls[1][1].body).history_complete).toBe(false);
});
it('disables integration when no application origin is configured',async()=>{
  await new SignupImportWorker({...config,app_url:undefined},'instance',{} as WhatsAppProvider).tick(vi.fn());expect(fetcher).not.toHaveBeenCalled();
});
it('tells the server to defer claims while WhatsApp is not ready',async()=>{
  fetcher.mockResolvedValueOnce(response({schedules:[],runs:[]}));
  await new SignupImportWorker(config,'instance',{ready:async()=>false} as unknown as WhatsAppProvider).tick(vi.fn());
  expect(JSON.parse(fetcher.mock.calls[0][1].body).ready).toBe(false);
});
it('does not send credentials through redirects and backs off endpoint failures',async()=>{
  fetcher.mockResolvedValue({ok:false,headers:new Headers()});const failed=vi.fn();
  const worker=new SignupImportWorker(config,'instance',{ready:async()=>true} as unknown as WhatsAppProvider);
  await worker.tick(failed);await worker.tick(failed);
  expect(fetcher).toHaveBeenCalledTimes(1);expect(failed).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0][1].redirect).toBe('error');
});

it('stops after the first 100 when the server finds a valid signup, even with older history available',async()=>{
  const history=vi.fn(async()=>({complete:false,has_more:true,messages:[{id:'latest',timestamp:1,body:'Signup\n1. Rafiul'}]}));
  fetcher.mockResolvedValueOnce(response({schedules:[],runs:[work]})).mockResolvedValueOnce(response({status:'imported'}));
  await new SignupImportWorker(config,'instance',{ready:async()=>true,history} as unknown as WhatsAppProvider).tick(vi.fn());
  expect(history).toHaveBeenCalledTimes(1);expect(history).toHaveBeenCalledWith(work.group_id,work.from,work.until,100);
});
it('expands only after no match and does not resend candidates already checked',async()=>{
  const first={id:'other-date',timestamp:1,body:'Signup\n1. Guest'},target={id:'target',timestamp:0,body:'Signup\n1. Rafiul'};
  const history=vi.fn().mockResolvedValueOnce({complete:false,has_more:true,messages:[first]}).mockResolvedValueOnce({complete:false,has_more:true,messages:[first,target]});
  fetcher.mockResolvedValueOnce(response({schedules:[],runs:[work]})).mockResolvedValueOnce(response({status:'searching'})).mockResolvedValueOnce(response({status:'needs_review'}));
  await new SignupImportWorker(config,'instance',{ready:async()=>true,history} as unknown as WhatsAppProvider).tick(vi.fn());
  expect(history.mock.calls.map(call=>call[3])).toEqual([100,500]);
  expect(JSON.parse(fetcher.mock.calls[2][1].body).messages.map((m:any)=>m.id)).toEqual(['target']);
});
it('stops immediately on a parse failure marked for review',async()=>{
  const history=vi.fn(async()=>({complete:false,has_more:true,messages:[{id:'broken',timestamp:1,body:'Signup\n1. Rafiul'}]}));
  fetcher.mockResolvedValueOnce(response({schedules:[],runs:[work]})).mockResolvedValueOnce(response({status:'needs_review'}));
  await new SignupImportWorker(config,'instance',{ready:async()=>true,history} as unknown as WhatsAppProvider).tick(vi.fn());
  expect(history).toHaveBeenCalledTimes(1);
});
it('checks 100, 500 and 2000 batches when none contains a matching signup',async()=>{
  const history=vi.fn().mockResolvedValueOnce({complete:false,has_more:true,messages:[]}).mockResolvedValueOnce({complete:false,has_more:true,messages:[]}).mockResolvedValueOnce({complete:false,has_more:false,messages:[]});
  fetcher.mockResolvedValueOnce(response({schedules:[],runs:[work]})).mockResolvedValueOnce(response({status:'searching'})).mockResolvedValueOnce(response({status:'searching'})).mockResolvedValueOnce(response({status:'needs_review'}));
  await new SignupImportWorker(config,'instance',{ready:async()=>true,history} as unknown as WhatsAppProvider).tick(vi.fn());
  expect(history.mock.calls.map(call=>call[3])).toEqual([100,500,2000]);expect(JSON.parse(fetcher.mock.calls[3][1].body).batch_final).toBe(true);
});
