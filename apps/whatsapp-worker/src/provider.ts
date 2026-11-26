import WhatsApp from 'whatsapp-web.js';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config.js';
import { root } from './config.js';
const { Client, LocalAuth } = WhatsApp;
export function browserPath(config: Partial<Config>) {
  if (config.chromium_path) return config.chromium_path;
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return existsSync(chrome) ? chrome : undefined;
}
export async function browserDoctor(config: Partial<Config> = {}) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node 22 or newer required');
  const require = createRequire(import.meta.url);
  const puppeteer = createRequire(require.resolve('whatsapp-web.js'))('puppeteer');
  const browser = await puppeteer.launch({ executablePath: browserPath(config), headless: true });
  try {
    const page = await browser.newPage();
    await page.goto('https://web.whatsapp.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    const text = await page.evaluate(() => document.body.innerText);
    if (/browser.*not supported|update your browser|unsupported browser/i.test(text)) throw new Error('WhatsApp Web rejects this browser');
    return { browser: await browser.version(), node: process.version, platform: process.platform, architecture: process.arch };
  } finally { await browser.close(); }
}
export class WhatsAppProvider {
  state = 'starting'; qr: string | null = null; qrAt = 0;
  client: InstanceType<typeof Client>;
  lastError: string | null = null;
  onDiagnostic: (event: string, fields: Record<string, unknown>) => void = () => {};
  private starting: Promise<void> | null = null;
  private reconnecting = false;
  private suspended = false;
  onAck: (id: string, ack: number) => void = () => {};
  constructor(config: Config) {
    this.client = new Client({ authTimeoutMs: 120000, webVersionCache: { type: 'local', path: join(root, 'web-cache') }, authStrategy: new LocalAuth({ dataPath: join(root, 'session') }), puppeteer: { executablePath: browserPath(config), headless: true } });
    this.client.on('qr', qr => { if (this.suspended) return; this.qr = qr; this.qrAt = Date.now(); this.state = 'qr_required'; this.lastError = null; this.onDiagnostic('whatsapp_qr_available', {}); });
    this.client.on('ready', () => { if (this.suspended) return; this.state = 'ready'; this.qr = null; this.lastError = null; this.onDiagnostic('whatsapp_ready', {}); });
    this.client.on('auth_failure', () => { if (this.suspended) return; this.state = 'auth_failure'; this.qr = null; this.lastError = 'WhatsApp could not authenticate the local session. Reconnect and check Linked Devices on your phone.'; this.onDiagnostic('whatsapp_auth_failure', {}); });
    this.client.on('disconnected', reason => { if (this.suspended) return;
      this.state = 'disconnected'; this.qr = null;
      this.lastError = 'WhatsApp disconnected. The worker will attempt to reconnect.';
      const knownReasons = ['LOGOUT', 'CONFLICT', 'UNPAIRED', 'UNPAIRED_IDLE', 'TIMEOUT', 'DEPRECATED_VERSION', 'PROXYBLOCK', 'TOS_BLOCK', 'SMB_TOS_BLOCK'];
      this.onDiagnostic('whatsapp_disconnected', { reason: knownReasons.includes(String(reason)) ? String(reason) : 'connection_closed' });
    });
    this.client.on('message_ack', (message, ack) => this.onAck(message.id._serialized, ack));
  }
  async connect() {
    if (this.starting) return this.starting;
    this.suspended = false;
    this.state = 'starting';
    this.onDiagnostic('whatsapp_initializing', {});
    this.starting = this.client.initialize().catch(error => {
      if(this.state !== 'auth_failure') this.state = 'disconnected';
      const diagnostic = initializationDiagnostic(error);
      this.lastError = diagnostic.message;
      if(!this.suspended)this.onDiagnostic('whatsapp_initialization_failed', { reason: diagnostic.code });
    }).finally(() => { this.starting = null; });
    return this.starting;
  }
  async reconnect() {
    if(this.reconnecting || this.starting) return;
    this.reconnecting=true; this.state='starting';
    try { await this.client.destroy().catch(() => {}); await this.connect(); } finally { this.reconnecting=false; }
  }
  /** Close Chrome while retaining LocalAuth. Explicit disconnect remains a logout. */
  async suspend() {
    this.suspended = true;
    if (this.starting) await this.starting;
    try { await this.client.destroy(); }
    catch (error) { this.state = 'disconnected'; throw error; }
    this.qr = null; this.state = 'idle';
  }
  async disconnect() { this.suspended = true; this.state = 'logged_out'; this.qr = null; await this.client.logout().catch(() => {}); await this.client.destroy().catch(() => {}); this.state = 'logged_out'; }
  async groups() { return (await this.client.getChats()).filter(chat => chat.isGroup).map(chat => ({ id: chat.id._serialized, name: chat.name })); }
  async ready() { return this.state === 'ready' && await this.client.getState() === 'CONNECTED'; }
  async acknowledgement(id: string) { const message=await this.client.getMessageById(id);return message ? Number(message.ack) : null; }
  async history(group: string, from: string, until: string, limit = 100) {
    if (!group.endsWith('@g.us')) throw new Error('Group source required');
    if (![100, 500, 2000].includes(limit)) throw new Error('Invalid history batch limit');
    const chat = await this.client.getChatById(group);
    const messages = await chat.fetchMessages({ limit });
    const complete = messages.some(message => message.timestamp * 1000 <= Date.parse(from));
    return { complete, has_more: !complete && messages.length >= limit && limit < 2000,
      messages: messages.filter(message => message.timestamp * 1000 >= Date.parse(from)
        && message.timestamp * 1000 <= Date.parse(until) && message.body && message.body.length <= 30000)
        .map(message => ({ id: message.id._serialized, timestamp: message.timestamp, body: message.body })) };
  }
  async send(group: string, body: string) {
    if (!group.endsWith('@g.us')) throw new Error('Group destination required');
    const message = await this.client.sendMessage(group, body, { waitUntilMsgSent: false });
    return { id: message.id._serialized, ack: Number(message.ack) };
  }
}

/** Only fixed messages leave the adapter; upstream errors can contain session/QR data. */
export function initializationDiagnostic(error: unknown) {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  if (message.includes('auth timeout') || message.includes('waiting failed') || message.includes('timeout'))
    return { code: 'initialization_timeout', message: 'WhatsApp initialization timed out before QR pairing was ready. Check the network and retry.' };
  if (message.includes('already running') || message.includes('singleton') || message.includes('processsingleton'))
    return { code: 'profile_in_use', message: 'The WhatsApp browser profile is already in use. Stop the other worker before reconnecting.' };
  if (message.includes('failed to launch') || message.includes('browser was not found') || message.includes('enoent'))
    return { code: 'browser_launch_failed', message: 'The WhatsApp browser could not start. Run the worker doctor and check the configured Chrome path.' };
  if (message.includes('net::err_'))
    return { code: 'network_failed', message: 'Chrome could not reach WhatsApp Web. Check the internet connection, proxy, or VPN.' };
  if (message.includes('execution context') || message.includes('target closed') || message.includes('session closed'))
    return { code: 'browser_context_closed', message: 'The WhatsApp page closed or reloaded during initialization. The worker will retry.' };
  return { code: 'initialization_failed', message: 'WhatsApp initialization failed. Check the private events log for its diagnostic category; no session data was logged.' };
}
