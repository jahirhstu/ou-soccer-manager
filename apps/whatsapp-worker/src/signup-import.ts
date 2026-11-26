import { WorkerOperationError } from './operations.js';
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
        const seen = new Set<string>();
        for (const limit of [100, 500, 2000]) {
          const history = run.group_id && await this.provider.ready()
            ? await this.provider.history(run.group_id, run.from, run.until, limit)
            : { messages: [], complete: false, has_more: false };
          const messages = history.messages.filter(m => likelySignup(m.body) && !seen.has(m.id));
          messages.forEach(message => seen.add(message.id));
          const result = await this.request('submit', { run_id: run.id, claim_token: run.claim_token, messages,
            history_complete: history.complete, batch_final: !history.has_more });
          // A valid roster (including a review draft) or parse failure ends the search.
          if (result.status !== 'searching' || !history.has_more) break;
        }
      }
      this.retryAfter = 0;
    } catch (error) { this.retryAfter = Date.now() + 60000; onFailure('signup_import', error); }
    finally { this.running = false; this.processing = false; }
  }
  private async request(action: string, data: Record<string, unknown> = {}) {
    const operation = `signup_${action}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.vercel_bypass_secret) headers['x-vercel-protection-bypass'] = this.config.vercel_bypass_secret;
    let response: Response;
    try {
      response = await fetch(`${this.config.app_url!.replace(/\/$/, '')}/api/worker/signup-import`, {
        method: 'POST', headers, redirect: 'error',
        body: JSON.stringify({ action, worker_id: this.config.worker_id, token: this.config.token, instance_id: this.instance, ...data }),
        signal: AbortSignal.timeout(action === 'submit' ? 280000 : 20000)
      });
    } catch (error) {
      const timeout = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
      throw new WorkerOperationError(operation, timeout ? 'endpoint_timeout' : 'endpoint_network_or_redirect_failed');
    }
    let payload: any;
    if (response.headers.get('content-type')?.includes('application/json')) {
      try { payload = await response.json(); }
      catch { throw new WorkerOperationError(operation, 'endpoint_invalid_json'); }
    }
    if (payload?.protection?.vercel_auth_enabled || payload?.protection?.password_enabled || payload?.message === 'Protected by Vercel Authentication') {
      throw new WorkerOperationError(operation, 'vercel_deployment_protected');
    }
    if (!response.ok) {
      const code = response.status === 401 ? 'worker_authorization_failed' : response.status === 404 ? 'endpoint_not_deployed'
        : response.status === 409 ? 'run_claim_unavailable' : response.status >= 500 ? 'endpoint_server_error' : 'endpoint_request_failed';
      throw new WorkerOperationError(operation, code);
    }
    if (!payload || (action === 'poll' ? !Array.isArray(payload.schedules) || !Array.isArray(payload.runs)
      : !['searching', 'needs_review', 'imported', 'failed', 'missed', 'queued', 'reading'].includes(payload.status))) {
      throw new WorkerOperationError(operation, 'endpoint_invalid_response');
    }
    return payload;
  }
}
