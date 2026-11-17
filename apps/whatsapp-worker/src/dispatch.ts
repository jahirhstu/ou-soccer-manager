import { dispatchDecision } from '../../../packages/communications/src/index.js';
export interface Attempt { id: string; attempt_id: string; scheduled_at: string; body: string; group_id: string; is_test?: boolean; expires_at?: string; schedule_id?: string | null; schedule_revision?: number }
export interface Result { id: string; attempt_id: string; status: 'sent'|'unknown'|'failed'|'missed'; dispatch_at: string | null; acknowledgement_at?: string; provider_message_id?: string; error?: string }
export interface DispatchDependencies {
  now(): number;
  ready(): Promise<boolean>;
  authorize(id: string): Promise<Attempt | null>;
  journal(result: Result): void;
  send(group: string, body: string): Promise<{ id: string; ack: number }>;
  report(result: Result): Promise<void>;
}
/** No retry path exists after final authorization and durable intent. */
export async function dispatch(execution: Attempt, deps: DispatchDependencies) {
  const decision = () => execution.is_test ? deps.now() > Date.parse(execution.expires_at!) ? 'missed' : 'send' : dispatchDecision(execution.scheduled_at, deps.now());
  if (decision() !== 'send' || !await deps.ready()) return;
  const authorized = await deps.authorize(execution.id);
  if (!authorized) return;
  const result: Result = { id: authorized.id, attempt_id: authorized.attempt_id, status: 'unknown', dispatch_at: null, error: 'Dispatch interrupted; delivery uncertain. No automatic retry.' };
  deps.journal(result);
  if (decision() !== 'send') { result.status='missed'; result.error='Final authorization exceeded the dispatch window; provider was not called'; deps.journal(result); await deps.report(result); return; }
  result.dispatch_at = new Date(deps.now()).toISOString();
  try {
    const message = await deps.send(authorized.group_id, authorized.body);
    result.provider_message_id = message.id;
    if (message.ack >= 1) { result.status = 'sent'; result.acknowledgement_at = new Date(deps.now()).toISOString(); delete result.error; }
    else if (message.ack === -1) { result.status = 'failed'; result.error = 'WhatsApp rejected the message'; }
    else { result.error = 'Awaiting server acknowledgement; no automatic retry'; }
  } catch { result.error = 'WhatsApp send outcome uncertain; no automatic retry'; }
  deps.journal(result);
  await deps.report(result);
}
