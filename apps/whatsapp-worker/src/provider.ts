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
  private starting: Promise<void> | null = null;
  private reconnecting = false;
  onAck: (id: string, ack: number) => void = () => {};
  constructor(config: Config) {
    this.client = new Client({ webVersionCache: { type: 'local', path: join(root, 'web-cache') }, authStrategy: new LocalAuth({ dataPath: join(root, 'session') }), puppeteer: { executablePath: browserPath(config), headless: true } });
    this.client.on('qr', qr => { this.qr = qr; this.qrAt = Date.now(); this.state = 'qr_required'; });
    this.client.on('ready', () => { this.state = 'ready'; this.qr = null; });
    this.client.on('auth_failure', () => { this.state = 'auth_failure'; this.qr = null; });
    this.client.on('disconnected', () => { this.state = 'disconnected'; this.qr = null; });
    this.client.on('message_ack', (message, ack) => this.onAck(message.id._serialized, ack));
  }
  async connect() {
    if (this.starting) return this.starting;
    this.state = 'starting';
    this.starting = this.client.initialize().catch(() => { if(this.state !== 'auth_failure') this.state = 'disconnected'; }).finally(() => { this.starting = null; });
    return this.starting;
  }
  async reconnect() {
    if(this.reconnecting || this.starting) return;
    this.reconnecting=true; this.state='starting';
    try { await this.client.destroy().catch(() => {}); await this.connect(); } finally { this.reconnecting=false; }
  }
  async disconnect() { this.state = 'logged_out'; this.qr = null; await this.client.logout().catch(() => {}); await this.client.destroy().catch(() => {}); this.state = 'logged_out'; }
  async groups() { return (await this.client.getChats()).filter(chat => chat.isGroup).map(chat => ({ id: chat.id._serialized, name: chat.name })); }
  async ready() { return this.state === 'ready' && await this.client.getState() === 'CONNECTED'; }
  async acknowledgement(id: string) { const message=await this.client.getMessageById(id);return message ? Number(message.ack) : null; }
  async send(group: string, body: string) {
    if (!group.endsWith('@g.us')) throw new Error('Group destination required');
    const message = await this.client.sendMessage(group, body, { waitUntilMsgSent: false });
    return { id: message.id._serialized, ack: Number(message.ack) };
  }
}
