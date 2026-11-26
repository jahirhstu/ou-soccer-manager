import { createHash } from 'node:crypto';
import { z } from 'zod';
import { occurrences } from '@ou/communications';
import { allocateSignup, asMessageSchedule, likelySignup, signupWindow, type GroupMessage, type SignupSchedule } from '../packages/communications/src/signup-import';
import { createSupabaseAdminClient } from './supabase/admin';
import { parseWhatsAppText, confirmWhatsAppImport } from './actions/import-service';
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
export async function selectSignupMessage(messages: GroupMessage[], targetDate: string, from: string, until: string, parse = parseWhatsAppText, onCandidate?: (message: GroupMessage) => Promise<void>) {
  const candidates = messages.filter(m => m.timestamp * 1000 >= Date.parse(from) && m.timestamp * 1000 <= Date.parse(until) && likelySignup(m.body))
    .sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id));
  for (let i = 0; i < candidates.length; i++) {
    const message = candidates[i];
    // A clearly dated list for another session is not a candidate for this run.
    const dateLine = message.body.split(/\r?\n/).find(line => /\bdate\s*:/i.test(line.replace(/[*_]/g, '')));
    const explicitDate = dateLine ? parseSessionDate(dateLine) : undefined;
    if (explicitDate && explicitDate !== targetDate) continue;
    if (i > 0 && candidates[i - 1].timestamp === message.timestamp) throw new Error('Conflicting signup messages have the same timestamp');
    await onCandidate?.(message);
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
  if (!result.length) throw new Error('No numbered signup roster found; manual import required');
  // Weekly signup posts contain a complete numbered roster. Prose-derived guesses
  // cannot add participants; missing real numbered names still fail above.
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
  const choices={...selections};
  for(const [name,value] of Object.entries(choices))if(value==='__create__') {
    const id=`__new__:${name}`;players.push({id,display_name:name});choices[name]=id;
  }
  return allocateSignup(parsed.players.map(p => p.name), players, aliases, members, run.configuration.capacity, choices);
}
/** Apply the shared allocation to a parser result; both UI and automatic confirmation use it. */
export function applySignupAllocation(parsed: ParsedWhatsAppImport, draft: ReturnType<typeof allocateSignup>) {
  const prepared = structuredClone(parsed);
  prepared.players = draft.rows.filter(row => row.status !== 'ignored').map(row => ({name:row.name,matchedPlayerId:row.player_id,confidence:'high'}));
  prepared.attendance = draft.rows.filter(row => row.status !== 'ignored').map(row => ({playerName:row.name,matchedPlayerId:row.player_id,status:row.status === 'confirmed' ? 'confirmed' : 'waitlisted',confidence:'high'}));
  prepared.payments=[];prepared.dropouts=[];prepared.teams=[];prepared.matches=[];prepared.goals=[];
  return prepared;
}
export async function loadSignupRun(db: DB, id: string, organizationId: string, programId: string) {
  const result=await db.from('signup_import_runs').select('*').eq('id',z.string().uuid().parse(id)).eq('organization_id',organizationId).single();
  if(result.error || !result.data || result.data.configuration.program_id!==programId) throw new Error('Signup run is unavailable in this organization and program');
  return result.data as SignupRun & {whatsapp_import_id?:string};
}
export async function signupRunPreview(db: DB, run: SignupRun, rawText?: string, selections: Record<string,string> = run.selections ?? {}) {
  const body=rawText ?? run.source_message?.body ?? run.incoming_messages?.[0]?.body;
  if(!body) return undefined;
  const {parsed}=await selectSignupMessage([{id:run.source_message?.id??'saved',timestamp:Date.parse(run.window_until)/1000,body}],run.target_date,run.window_from,run.window_until);
  const draft=await prepareSignupDraft(db,run,parsed,selections);
  const prepared=applySignupAllocation(parsed,draft);
  if(draft.needs_review)prepared.warnings.push('Resolve all player identities and recalculate before confirming this signup.');
  return {parsed:prepared,draft};
}

export async function processSignupRun(db: DB, run: SignupRun, messages: GroupMessage[], historyComplete: boolean, review = false, moreHistoryAvailable = false) {
  const retainCandidate = async (message?: GroupMessage) => {
    let query = db.from('signup_import_runs').update({ incoming_messages: message ? [message] : [], history_complete: historyComplete })
      .eq('id', run.id).eq('organization_id', run.organization_id).eq('status', review ? 'needs_review' : 'reading');
    if (!review) query = query.eq('claim_token', run.claim_token);
    const result = await query;
    if (result.error) throw new Error(result.error.message);
  };
  // Each repost is a full snapshot. Keep only the candidate actually being parsed,
  // including failures, so retries never preserve the rest of the fetched batch.
  await retainCandidate();
  let selected: Awaited<ReturnType<typeof selectSignupMessage>>;
  try { selected = await selectSignupMessage(messages, run.target_date, run.window_from, run.window_until, parseWhatsAppText, retainCandidate); }
  catch (error) {
    if (error instanceof SignupMessageNotFoundError) {
      await retainCandidate();
      if (moreHistoryAvailable) return { status: 'searching', id: run.id };
      if (!historyComplete) throw new Error('No matching signup found within the available WhatsApp history; manual review required');
    }
    throw error;
  }
  const { source, parsed } = selected;
  const draft = await prepareSignupDraft(db, run, parsed);
  const attendanceReview = Boolean(parsed.dropouts?.length || parsed.attendance?.some(row => !['confirmed', 'waitlisted'].includes(row.status)));
  const parserReview = parsed.confidence === 'low' || parsed.players.some(player => player.confidence === 'low') || parsed.parser?.fallbackUsed || Boolean(parsed.warnings?.length) || attendanceReview;
  const prepared=applySignupAllocation(parsed,draft);
  const reviewReason=draft.needs_review ? 'Resolve player identities or season capacity in WhatsApp import' : parserReview ? 'Parser warnings require review in WhatsApp import' : null;
  const checkpoint=await db.from('signup_import_runs').update({source_message:source,parsed_json:prepared,draft,selections:run.selections,status:reviewReason?'needs_review':'reading',error:reviewReason,updated_at:new Date().toISOString()}).eq('id',run.id).eq('claim_token',run.claim_token);
  if(checkpoint.error)throw new Error(checkpoint.error.message);
  if(reviewReason)return {id:run.id,status:'needs_review'};
  const form=new FormData();form.set('rawText',source.body);form.set('parsedJson',JSON.stringify(prepared));form.set('seasonId',run.configuration.season_id);form.set('sessionId','__create__');form.set('signupRunId',run.id);
  for(const row of draft.rows)if(row.player_id)form.set(`match_${row.name}`,row.player_id);
  const result=await confirmWhatsAppImport(null,form,{client:db as any,profile:{id:run.configuration.created_by!,role:'admin',organization_id:run.organization_id},program:{id:run.configuration.program_id},automaticSignup:true,signupClaimToken:run.claim_token??undefined});
  if(result.error)throw new Error(result.error);
  return {id:run.id,status:'imported'};
}
