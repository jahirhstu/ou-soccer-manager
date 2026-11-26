import { beforeEach, describe, expect, it, vi } from 'vitest';
const calls=vi.hoisted(()=>({ initialize:vi.fn(async()=>{}),destroy:vi.fn(async()=>{}),logout:vi.fn(async()=>{}),sendMessage:vi.fn(async()=>({id:{_serialized:'message'},ack:0})),getChats:vi.fn(async()=>[{isGroup:true,id:{_serialized:'group@g.us'},name:'Soccer'},{isGroup:false,id:{_serialized:'person@c.us'},name:'Person'}]),getChatById:vi.fn(),auth:vi.fn(),options:vi.fn(),on:new Map<string,Function>() }));
vi.mock('../../apps/whatsapp-worker/node_modules/whatsapp-web.js',()=>({default:{LocalAuth:class{constructor(options:unknown){calls.auth(options);}},Client:class{
  constructor(options:unknown){calls.options(options);}
  initialize=calls.initialize;destroy=calls.destroy;logout=calls.logout;sendMessage=calls.sendMessage;getChats=calls.getChats;getChatById=calls.getChatById;
  on(event:string,callback:Function){calls.on.set(event,callback);}
  getState=async()=>'CONNECTED';getMessageById=async()=>({ack:1});
}}}));
import { WhatsAppProvider } from '../../apps/whatsapp-worker/src/provider';
const config={supabase_url:'https://example.supabase.co',publishable_key:'public',worker_id:'worker',token:'token'};
beforeEach(()=>{vi.clearAllMocks();calls.on.clear();});
describe('local WhatsApp adapter with a mocked client',()=>{
  it('uses the same local auth directory across worker restarts',()=>{new WhatsAppProvider(config);new WhatsAppProvider(config);expect(calls.auth.mock.calls[0][0]).toEqual(calls.auth.mock.calls[1][0]);expect(calls.auth.mock.calls[0][0].dataPath).toContain('/session');});
  it('tracks QR, ready, disconnect, and reconnect states',async()=>{
    const p=new WhatsAppProvider(config);await p.connect();calls.on.get('qr')!('private-qr');expect(p.state).toBe('qr_required');
    calls.on.get('ready')!();expect(p.qr).toBeNull();expect(await p.ready()).toBe(true);
    calls.on.get('disconnected')!();expect(p.state).toBe('disconnected');await p.reconnect();expect(calls.destroy).toHaveBeenCalledOnce();expect(calls.initialize).toHaveBeenCalledTimes(2);
  });
  it('lists groups and rejects direct-message destinations',async()=>{
    const p=new WhatsAppProvider(config);expect(await p.groups()).toEqual([{id:'group@g.us',name:'Soccer'}]);await expect(p.send('person@c.us','Hello')).rejects.toThrow('Group destination');expect(calls.sendMessage).not.toHaveBeenCalled();
  });
  it('logs out explicitly and does not retain the QR',async()=>{const p=new WhatsAppProvider(config);await p.disconnect();expect(calls.logout).toHaveBeenCalledOnce();expect(p.state).toBe('logged_out');expect(p.qr).toBeNull();});
});

describe('connection diagnostics',()=>{
  it('allows two minutes for WhatsApp authentication scripts to initialize',()=>{
    new WhatsAppProvider(config);expect(calls.options).toHaveBeenCalledWith(expect.objectContaining({authTimeoutMs:120000}));
  });
  it('reports initialization timeouts without exposing upstream error contents',async()=>{
    calls.initialize.mockRejectedValueOnce(new Error('auth timeout PRIVATE_SESSION_DATA'));
    const provider=new WhatsAppProvider(config),diagnostic=vi.fn();provider.onDiagnostic=diagnostic;
    await provider.connect();
    expect(provider.state).toBe('disconnected');
    expect(provider.lastError).toContain('timed out');
    expect(diagnostic).toHaveBeenCalledWith('whatsapp_initialization_failed',{reason:'initialization_timeout'});
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('PRIVATE_SESSION_DATA');
  });
  it('never logs QR data and clears errors when pairing becomes available',async()=>{
    const provider=new WhatsAppProvider(config),diagnostic=vi.fn();provider.onDiagnostic=diagnostic;
    provider.lastError='Previous failure';calls.on.get('qr')!('PRIVATE_QR');
    expect(provider.lastError).toBeNull();expect(provider.qr).toBe('PRIVATE_QR');
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('PRIVATE_QR');
  });
  it('limits disconnect reasons to known non-sensitive values',()=>{
    const provider=new WhatsAppProvider(config),diagnostic=vi.fn();provider.onDiagnostic=diagnostic;
    calls.on.get('disconnected')!('sensitive upstream detail');
    expect(diagnostic).toHaveBeenCalledWith('whatsapp_disconnected',{reason:'connection_closed'});
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('sensitive upstream detail');
  });
  it('shares a pending initialization instead of launching competing browser instances',async()=>{
    let finish!:()=>void;calls.initialize.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
    const provider=new WhatsAppProvider(config);const first=provider.connect(),second=provider.connect();
    expect(calls.initialize).toHaveBeenCalledOnce();finish();await Promise.all([first,second]);
  });
});

it('suspends without logout, ignores intentional disconnect events, and resumes saved authentication',async()=>{
  const provider=new WhatsAppProvider(config);await provider.connect();
  await provider.suspend();calls.on.get('disconnected')!('LOGOUT');
  expect(calls.logout).not.toHaveBeenCalled();expect(provider.state).toBe('idle');
  expect(await provider.ready()).toBe(false);
  await provider.connect();calls.on.get('ready')!();expect(provider.state).toBe('ready');expect(calls.initialize).toHaveBeenCalledTimes(2);
});
it('does not emit a connection failure for intentional logout',async()=>{
  const provider=new WhatsAppProvider(config),diagnostic=vi.fn();provider.onDiagnostic=diagnostic;
  await provider.disconnect();calls.on.get('disconnected')!('LOGOUT');
  expect(provider.state).toBe('logged_out');expect(diagnostic).not.toHaveBeenCalled();
});

it('requires history coverage before treating a group scan as complete',async()=>{
  const from='2026-11-24T02:00:00Z',until='2026-11-27T01:00:00Z';
  const fetchMessages=vi.fn(async()=>[
    {id:{_serialized:'boundary'},timestamp:Date.parse(from)/1000-1,body:'Earlier chat'},
    {id:{_serialized:'signup'},timestamp:Date.parse(from)/1000+1,body:'Signup list'},
    {id:{_serialized:'future'},timestamp:Date.parse(until)/1000+1,body:'Later update'}
  ]);
  calls.getChatById.mockResolvedValue({fetchMessages});
  const result=await new WhatsAppProvider(config).history('group@g.us',from,until);
  expect(result.complete).toBe(true);expect(result.messages.map(m=>m.id)).toEqual(['signup']);
});
it('does not mistake truncated available history for a complete scan',async()=>{
  const fetchMessages=vi.fn(async()=>[{id:{_serialized:'recent'},timestamp:Date.parse('2026-11-26T12:00:00Z')/1000,body:'Signup'}]);
  calls.getChatById.mockResolvedValue({fetchMessages});
  expect((await new WhatsAppProvider(config).history('group@g.us','2026-11-24T02:00:00Z','2026-11-27T01:00:00Z')).complete).toBe(false);
});

it('fetches only the requested batch instead of expanding history internally',async()=>{
  const fetchMessages=vi.fn(async()=>Array.from({length:100},(_,i)=>({id:{_serialized:String(i)},timestamp:Date.parse('2026-11-26T12:00:00Z')/1000,body:'Chat'})));
  calls.getChatById.mockResolvedValue({fetchMessages});
  const batch=await new WhatsAppProvider(config).history('group@g.us','2026-11-24T02:00:00Z','2026-11-27T01:00:00Z',100);
  expect(fetchMessages).toHaveBeenCalledTimes(1);expect(fetchMessages).toHaveBeenCalledWith({limit:100});expect(batch.has_more).toBe(true);expect(batch.complete).toBe(false);
});
