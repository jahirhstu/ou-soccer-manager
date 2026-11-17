import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { mkdirSync, statSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, existsSync, appendFileSync } from 'node:fs';
export const root = resolve(process.env.OU_WHATSAPP_HOME || join(homedir(), 'Library/Application Support/OU Soccer WhatsApp'));
export interface Config { supabase_url: string; publishable_key: string; worker_id: string; token: string; chromium_path?: string; port?: number }
export function privateDirectory() {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (statSync(root).mode & 0o077) throw new Error('Worker directory must have permissions 0700');
}
export function readConfig(): Config {
  privateDirectory(); const path = join(root, 'config.json');
  if (statSync(path).mode & 0o077) throw new Error('config.json must have permissions 0600');
  let c: Config;
  try { c = JSON.parse(readFileSync(path, 'utf8')); } catch { throw new Error('Invalid config.json; correct it privately'); }
  if (!/^https:\/\//.test(c.supabase_url) && !/^http:\/\/(127\.0\.0\.1|localhost):/.test(c.supabase_url)) throw new Error('HTTPS Supabase URL required');
  if (!c.publishable_key || !/^[0-9a-f-]{36}$/.test(c.worker_id) || !/^[0-9a-f]{64}$/.test(c.token)) throw new Error('Invalid worker configuration');
  if (c.port && (!Number.isInteger(c.port) || c.port<1024 || c.port>65535)) throw new Error('Invalid pairing port');
  return c;
}
export function persist(path: string, value: unknown) {
  const temp = path + '.tmp';
  const fd = openSync(temp, 'w', 0o600);
  try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, path);
}
export function log(event: string, fields: Record<string, unknown> = {}) {
  const path=join(root,'events.log');
  if(existsSync(path)&&statSync(path).size>5_000_000)renameSync(path,path+'.previous');
  appendFileSync(path,JSON.stringify({at:new Date().toISOString(),event,...fields})+'\n',{mode:0o600});
}
