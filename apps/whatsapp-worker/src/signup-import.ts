import type { Config } from './config.js';
import type { WhatsAppProvider } from './provider.js';
import { likelySignup, type SignupSchedule } from '../../../packages/communications/src/signup-import.js';

type Work = { id: string; claim_token: string; group_id?: string; from: string; until: string };
/** Uses the app's parser, never copies LLM credentials into the local worker. */
export class SignupImportWorker {
  schedules: SignupSchedule[] = [];
  running = false;
  processing = false;
  private retryAfter = 0;
  constructor(private config: Config, private instance: string, private provider: WhatsAppProvider) {}
  async tick(onFailure: (step: string, error: unknown) => void) {
    if (!this.config.app_url || this.running || Date.now() < this.retryAfter) return;
    this.running = true;
    try {
      const packet = await this.request('poll', { ready: await this.provider.ready() }) as { schedules: SignupSchedule[]; runs: Work[] };
      this.schedules = packet.schedules;
      this.processing = packet.runs.length > 0;
      for (const run of packet.runs) {
        let messages: Array<{ id: string; timestamp: number; body: string }> = [], complete = false;
        if (run.group_id && await this.provider.ready()) {
          const history = await this.provider.history(run.group_id, run.from, run.until);
          messages = history.messages.filter(m => likelySignup(m.body)); complete = history.complete;
        }
        await this.request('submit', { run_id: run.id, claim_token: run.claim_token, messages, history_complete: complete });
      }
      this.retryAfter = 0;
    } catch (error) { this.retryAfter = Date.now() + 60000; onFailure('signup_import', error); }
    finally { this.running = false; this.processing = false; }
  }
  private async request(action: string, data: Record<string, unknown> = {}) {
    const response = await fetch(`${this.config.app_url!.replace(/\/$/, '')}/api/worker/signup-import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error',
      body: JSON.stringify({ action, worker_id: this.config.worker_id, token: this.config.token, instance_id: this.instance, ...data }),
      signal: AbortSignal.timeout(action === 'submit' ? 280000 : 20000)
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Signup import endpoint unavailable');
    return response.json();
  }
}
