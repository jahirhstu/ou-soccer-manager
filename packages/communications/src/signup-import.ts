import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';
import { scheduleSchema, type ScheduleInput } from './index';
import { importIdentityCandidates, type ImportAlias, type ImportIdentity } from '../../contracts/src/import-identity';

export const signupScheduleSchema = z.object({
  name: z.string().trim().min(1).max(120), season_id: z.string().uuid(), destination_id: z.string().uuid(),
  timezone: z.string(), local_time: z.string(), weekday: z.number().int().min(1).max(7),
  session_weekday: z.number().int().min(1).max(7).default(7), capacity: z.number().int().min(1).max(200).default(21),
  opening_weekday: z.number().int().min(1).max(7).default(1), opening_time: z.string().default('21:00:00'),
  enabled: z.boolean().default(false)
}).superRefine((s, ctx) => {
  const result = scheduleSchema.safeParse(asMessageSchedule(s));
  if (!result.success) for (const issue of result.error.issues) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  try { Temporal.PlainTime.from(s.opening_time); } catch { ctx.addIssue({ code: 'custom', path: ['opening_time'], message: 'Invalid signup opening time' }); }
});
export type SignupScheduleInput = z.infer<typeof signupScheduleSchema>;
export type SignupSchedule = SignupScheduleInput & { id: string; organization_id: string; program_id: string; created_at: string; updated_at: string; created_by?: string };
export function asMessageSchedule(s: Pick<SignupScheduleInput, 'name' | 'timezone' | 'local_time' | 'weekday' | 'enabled' | 'destination_id'>): ScheduleInput {
  return { name: s.name, body: 'Signup import', destination_id: s.destination_id, timezone: s.timezone, local_time: s.local_time,
    frequency: 'weekly', weekdays: [s.weekday], local_date: null, venue: '', match_time: '', enabled: s.enabled };
}
export function signupWindow(s: SignupScheduleInput, execution: string) {
  const at = Temporal.Instant.from(execution).toZonedDateTimeISO(s.timezone);
  const target = at.toPlainDate().add({ days: (s.session_weekday - at.dayOfWeek + 7) % 7 });
  let opening = at.toPlainDate().subtract({ days: (at.dayOfWeek - s.opening_weekday + 7) % 7 })
    .toPlainDateTime(s.opening_time).toZonedDateTime(s.timezone, { disambiguation: 'earlier' });
  if (Temporal.ZonedDateTime.compare(opening, at) > 0) opening = opening.subtract({ days: 7 });
  return { target_date: target.toString(), from: opening.toInstant().toString(), until: at.toInstant().toString() };
}
export type GroupMessage = { id: string; timestamp: number; body: string };
/** Broad detection only. The existing parser determines the message's meaning and session date. */
export function likelySignup(body: string) {
  return /^\s*\d{1,3}[.)]\s*\S/m.test(body.replace(/[\u200b-\u200f\u2060\ufeff*]/g, ''))
    && /signup|sign\s*up|head\s*count|availability|wait\s*list|here are|confirmed|players/i.test(body);
}
export type DraftPlayer = { name: string; player_id?: string; candidates: ImportIdentity[]; member: boolean; status: 'confirmed' | 'waitlisted' | 'unresolved' | 'ignored'; order: number };
export function allocateSignup(names: string[], players: ImportIdentity[], aliases: ImportAlias[], members: Set<string>, capacity: number, selections: Record<string, string> = {}) {
  const seen = new Set<string>();
  const rows: DraftPlayer[] = [];
  for (const name of names) {
    const candidates = importIdentityCandidates(name, players, aliases);
    const selected = selections[name];
    if (selected === '__ignore__') { rows.push({ name, candidates, member: false, status: 'ignored', order: rows.length }); continue; }
    if (selected && !players.some(p => p.id === selected)) throw new Error(`Invalid player selected for ${name}`);
    // Suggestions are not sufficient for unattended imports: exact name/alias plus one candidate required.
    const key = identityKey(name);
    const exact = candidates.length === 1 && (identityKey(candidates[0].display_name) === key || aliases.some(a => a.player_id === candidates[0].id && identityKey(a.alias_name) === key));
    const id = selected || (exact ? candidates[0].id : undefined);
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    rows.push({ name, player_id: id, candidates, member: Boolean(id && members.has(id)), status: id ? 'waitlisted' : 'unresolved', order: rows.length });
  }
  const resolved = rows.filter(r => r.player_id).sort((a, b) => Number(b.member) - Number(a.member) || a.order - b.order);
  resolved.forEach((r, i) => { r.status = i < capacity ? 'confirmed' : 'waitlisted'; });
  const overflow = resolved.filter(r => r.member).length > capacity;
  return { rows, needs_review: overflow || rows.some(r => r.status === 'unresolved'), overflow };
}
function identityKey(value: string) { return value.normalize('NFKC').toLocaleLowerCase('en').trim().replace(/\s+/g, ' '); }
