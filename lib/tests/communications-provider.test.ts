import { beforeEach, describe, expect, it, vi } from 'vitest';
const calls=vi.hoisted(()=>({ initialize:vi.fn(async()=>{}),destroy:vi.fn(async()=>{}),logout:vi.fn(async()=>{}),sendMessage:vi.fn(async()=>({id:{_serialized:'message'},ack:0})),getChats:vi.fn(async()=>[{isGroup:true,id:{_serialized:'group@g.us'},name:'Soccer'},{isGroup:false,id:{_serialized:'person@c.us'},name:'Person'}]),auth:vi.fn(),options:vi.fn(),on:new Map<string,Function>() }));
vi.mock('../../apps/whatsapp-worker/node_modules/whatsapp-web.js',()=>({default:{LocalAuth:class{constructor(options:unknown){calls.auth(options);}},Client:class{
  constructor(options:unknown){calls.options(options);}
  initialize=calls.initialize;destroy=calls.destroy;logout=calls.logout;sendMessage=calls.sendMessage;getChats=calls.getChats;
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
