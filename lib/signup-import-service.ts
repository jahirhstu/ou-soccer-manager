import { createHash } from 'node:crypto';
import { z } from 'zod';
import { occurrences } from '@ou/communications';
import { allocateSignup, asMessageSchedule, likelySignup, signupWindow, type GroupMessage, type SignupSchedule } from '../packages/communications/src/signup-import';
import { createSupabaseAdminClient } from './supabase/admin';
import { parseWhatsAppText } from './actions/import-service';
import { normalizePlayerName, parseSessionDate } from './utils';
import type { ParsedWhatsAppImport } from './types';

type DB = ReturnType<typeof createSupabaseAdminClient>;
export type SignupRun = {
  id: string; organization_id: string; schedule_id: string; scheduled_at: string; target_date: string;
  window_from: string; window_until: string; configuration: SignupSchedule; manual: boolean;
  status: string; claim_token: string | null; claimed_by: string | null; claim_until: string | null;
  incoming_messages?: GroupMessage[]; history_complete?: boolean;
  source_message: (GroupMessage & { hash: string }) | null; parsed_json: ParsedWhatsAppImport | null;
  draft: ReturnType<typeof allocateSignup> | null; selections: Record<string, string>; session_id: string | null; error: string | null;
};
export const workerInput = z.object({ worker_id: z.string().uuid(), token: z.string().regex(/^[a-f0-9]{64}$/), instance_id: z.string().uuid() });
export async function workerOrganization(db: DB, input: z.infer<typeof workerInput>) {
  const { data, error } = await db.rpc('signup_import_worker_context', { p_worker_id: input.worker_id, p_token: input.token, p_instance_id: input.instance_id });
  if (error || !data) throw new Error('Worker authorization failed');
  return data as string;
}
export async function pollSignupRuns(db: DB, organizationId: string, instanceId: string, ready = true) {
  const { data, error } = await db.from('signup_import_schedules').select('*').eq('organization_id', organizationId).eq('enabled', true);
  if (error) throw error;
  const schedules = (data ?? []) as SignupSchedule[];
  const runs: SignupRun[] = [];
  const now = Date.now();
  for (const schedule of schedules) {
    const from = new Date(Math.max(Date.parse(schedule.created_at), Date.parse(schedule.updated_at), now - 7 * 86400000)).toISOString();
    const times = occurrences(asMessageSchedule(schedule), from, new Date(now + 1).toISOString());
    for (const at of times) {
      if (!ready && Date.parse(at) >= now - 3600000) continue;
      const result = await db.rpc('signup_import_claim', { p_organization_id: organizationId, p_schedule_id: schedule.id, p_instance_id: instanceId, p_scheduled_at: at, p_window: signupWindow(schedule, at) });
      if (result.error) throw new Error(result.error.message);
      if (result.data) runs.push(result.data as SignupRun);
    }
  }
  // Explicit reruns use a saved target date and current message snapshot window.
  const manual = await db.from('signup_import_runs').select('*').eq('organization_id', organizationId).eq('manual', true).in('status', ['queued', 'reading']).limit(20);
  if (manual.error) throw new Error(manual.error.message);
  for (const row of ready ? manual.data ?? [] : []) {
    const result = await db.rpc('signup_import_claim', { p_organization_id: organizationId, p_schedule_id: row.schedule_id, p_instance_id: instanceId, p_scheduled_at: row.scheduled_at, p_window: { target_date: row.target_date, from: row.window_from, until: row.window_until } });
    if (result.error) throw new Error(result.error.message);
    if (result.data) runs.push(result.data as SignupRun);
  }
  const destinations = await db.from('message_destinations').select('id,group_id').eq('organization_id', organizationId);
  if (destinations.error) throw new Error(destinations.error.message);
  return { schedules, runs: runs.map(run => ({ id: run.id, claim_token: run.claim_token, from: run.window_from, until: run.window_until,
    group_id: destinations.data?.find(d => d.id === run.configuration.destination_id)?.group_id })) };
}

export class SignupMessageNotFoundError extends Error {}

/** Newest plausible target-date list wins; parser failure never falls back to an older list. */
export async function selectSignupMessage(messages: GroupMessage[], targetDate: string, from: string, until: string, parse = parseWhatsAppText) {
  const candidates = messages.filter(m => m.timestamp * 1000 >= Date.parse(from) && m.timestamp * 1000 <= Date.parse(until) && likelySignup(m.body))
    .sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id));
  for (let i = 0; i < candidates.length; i++) {
    const message = candidates[i];
    // A clearly dated list for another session is not a candidate for this run.
    const dateLine = message.body.split(/\r?\n/).find(line => /\bdate\s*:/i.test(line.replace(/[*_]/g, '')));
    const explicitDate = dateLine ? parseSessionDate(dateLine) : undefined;
    if (explicitDate && explicitDate !== targetDate) continue;
    if (i > 0 && candidates[i - 1].timestamp === message.timestamp) throw new Error('Conflicting signup messages have the same timestamp');
    const parsed = await parse(message.body);
    if (!parsed.session?.date) throw new Error('Latest signup message has no clear session date');
    if (parsed.session.date !== targetDate) {
      if (explicitDate === targetDate) throw new Error('Parser date disagrees with the signup message');
      continue;
    }
    if (candidates.slice(i + 1).some(other => other.timestamp === message.timestamp && other.body !== message.body)) throw new Error('Conflicting signup messages have the same timestamp');
    if (parsed.importType !== 'session_update' || !parsed.players?.length) throw new Error('Latest signup message does not contain a valid session roster');
    const names = orderedSignupNames(message.body, parsed.players.map(p => p.name));
    parsed.players = names.map(name => parsed.players.find(p => p.name === name)!);
    return { source: { ...message, hash: createHash('sha256').update(message.body).digest('hex') }, parsed };
  }
  throw new SignupMessageNotFoundError('No weekly signup message found for the target session date');
}

/** The message's list order, rather than an LLM's output order, breaks priority ties. */
export function orderedSignupNames(rawText: string, parsedNames: string[]) {
  const lines = rawText.replace(/[\u200b-\u200f\u2060\ufeff*]/g, '').split(/\r?\n/);
  const rawNames = lines.flatMap(line => {
    const match = line.match(/^\s*\d{1,3}[.)]\s*(.+)$/u);
    if (!match) return [];
    const clean = normalizePlayerName(match[1].replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s+[-–].*$/, '').replace(/[^\p{L}\p{M}\s.'-]/gu, ' ').replace(/\s+/g, ' ').trim());
    return clean ? [clean] : [];
  });
  const key = (s: string) => s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  const result: string[] = [];
  for (const name of rawNames) {
    const parsed = parsedNames.find(n => key(n) === key(name));
    if (!parsed) throw new Error(`Parser did not preserve the numbered roster entry: ${name}`);
    if (!result.includes(parsed)) result.push(parsed);
  }
  if (!result.length || parsedNames.some(n => !result.includes(n))) throw new Error(`Parsed roster differs from the numbered signup list (${parsedNames.filter(n => !result.includes(n)).join(', ')}); manual import required`);
  return result;
}
async function identityScope(db: DB, run: SignupRun) {
  const [players, aliases, imports] = await Promise.all([
    db.from('players').select('id,display_name').eq('organization_id', run.organization_id).limit(1000),
    db.from('player_aliases').select('player_id,alias_name').eq('organization_id', run.organization_id).limit(1000),
    db.from('whatsapp_imports').select('parsed_json').eq('organization_id', run.organization_id).eq('program_id', run.configuration.program_id).eq('season_id', run.configuration.season_id).eq('status', 'confirmed').eq('parsed_json->>importType', 'season_signup').limit(1000)
  ]);
  for (const result of [players, aliases, imports]) if (result.error) throw new Error(result.error.message);
  if ([players, aliases, imports].some(result => (result.data?.length ?? 0) >= 1000)) throw new Error('Identity scope exceeds the safe review limit');
  if (!imports.data?.length) throw new Error('No confirmed season signup roster exists for the configured season');
  const members = new Set<string>();
  for (const row of imports.data) for (const player of row.parsed_json?.players ?? []) if (player.matchedPlayerId) members.add(player.matchedPlayerId);
  if (!members.size) throw new Error('Season signup roster has no reviewed player identities');
  return { players: players.data ?? [], aliases: aliases.data ?? [], members };
}
export async function prepareSignupDraft(db: DB, run: SignupRun, parsed: ParsedWhatsAppImport, selections = run.selections) {
  const { players, aliases, members } = await identityScope(db, run);
  return allocateSignup(parsed.players.map(p => p.name), players, aliases, members, run.configuration.capacity, selections);
}
export async function saveSignupDraft(db: DB, run: SignupRun, payload: Record<string, unknown>, finalize: boolean, review = false) {
  const args = { p_run_id: run.id, p_organization_id: run.organization_id, p_claim_token: run.claim_token, p_payload: payload, p_finalize: finalize, p_review: review };
  const result = await db.rpc('signup_import_save', args);
  if (result.error && finalize && !review) {
    // Keep session preparation/review available when existing attendance prevents automatic application.
    const draft = await db.rpc('signup_import_save', { ...args, p_finalize: false, p_payload: { ...payload, error: result.error.message } });
    if (draft.error) throw new Error(draft.error.message);
    return draft.data;
  }
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
export async function processSignupRun(db: DB, run: SignupRun, messages: GroupMessage[], historyComplete: boolean, review = false, moreHistoryAvailable = false) {
  let selected: Awaited<ReturnType<typeof selectSignupMessage>>;
  try { selected = await selectSignupMessage(messages, run.target_date, run.window_from, run.window_until); }
  catch (error) {
    if (error instanceof SignupMessageNotFoundError) {
      if (moreHistoryAvailable) return { status: 'searching', id: run.id };
      if (!historyComplete) throw new Error('No matching signup found within the available WhatsApp history; manual review required');
    }
    throw error;
  }
  const { source, parsed } = selected;
  const draft = await prepareSignupDraft(db, run, parsed);
  const attendanceReview = Boolean(parsed.dropouts?.length || parsed.attendance?.some(row => !['confirmed', 'waitlisted'].includes(row.status)));
  const parserReview = parsed.confidence === 'low' || parsed.players.some(player => player.confidence === 'low') || parsed.parser?.fallbackUsed || Boolean(parsed.warnings?.length) || attendanceReview;
  return saveSignupDraft(db, run, { source_message: source, parsed_json: parsed, draft, selections: run.selections,
    error: draft.overflow ? 'Listed season members exceed capacity' : attendanceReview ? 'Message includes withdrawals or attendance changes; review and ignore unavailable players before finalizing' : parserReview ? 'Parser warnings require review' : run.manual ? 'Review the updated roster before applying this rerun' : null }, !draft.needs_review && !parserReview && !run.manual, review);
}
