import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';

export const scheduleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  body: z.string().min(1).max(10000),
  destination_id: z.string().uuid().nullable(),
  frequency: z.enum(['once', 'daily', 'weekly']),
  timezone: z.string().refine(value => { try { Temporal.Now.zonedDateTimeISO(value); return true; } catch { return false; } }, 'Invalid timezone'),
  local_time: z.string().regex(/^\d{2}:\d{2}:\d{2}$/).refine(value => { try { Temporal.PlainTime.from(value); return true; } catch { return false; } }),
  local_date: z.string().nullable(),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7),
  venue: z.string().max(1000), match_time: z.string().max(200), enabled: z.boolean()
}).superRefine((s, ctx) => {
  if (s.frequency === 'weekly' && !s.weekdays.length) ctx.addIssue({ code: 'custom', message: 'Choose at least one weekday' });
  if (s.enabled && !s.destination_id) ctx.addIssue({ code: 'custom', message: 'Choose a destination before enabling' });
  if (s.frequency === 'once') {
    try { oneTimeInstant(s); } catch { ctx.addIssue({ code: 'custom', message: 'One-time date/time is invalid or does not exist in this timezone' }); }
  }
});
export type ScheduleInput = z.infer<typeof scheduleSchema>;
export type Schedule = ScheduleInput & { id: string; organization_id: string; revision: number; created_at: string };
export type ExecutionStatus = 'pending' | 'sent' | 'failed' | 'missed' | 'unknown' | 'cancelled';
export interface Execution { id: string; scheduled_at: string; body: string; group_id: string; status: ExecutionStatus; dispatch_at?: string; acknowledgement_at?: string; latency_ms?: number; error?: string }

export function oneTimeInstant(s: Pick<ScheduleInput, 'local_date' | 'local_time' | 'timezone'>) {
  const local = Temporal.PlainDateTime.from(`${s.local_date}T${s.local_time}`);
  const zoned = local.toZonedDateTime(s.timezone, { disambiguation: 'earlier' });
  if (!zoned.toPlainDateTime().equals(local)) throw new Error('Nonexistent local time');
  return zoned.toInstant().toString();
}

/** Inclusive start; exclusive end. Recurrences use wall-clock dates, not 24-hour intervals. */
export function occurrences(s: ScheduleInput, from: string, until: string, limit = 10000): string[] {
  const start = Temporal.Instant.from(from), end = Temporal.Instant.from(until);
  if (s.frequency === 'once') {
    const instant = Temporal.Instant.from(oneTimeInstant(s));
    return Temporal.Instant.compare(instant, start) >= 0 && Temporal.Instant.compare(instant, end) < 0 ? [instant.toString()] : [];
  }
  const result: string[] = [];
  let date = start.toZonedDateTimeISO(s.timezone).toPlainDate();
  const last = end.toZonedDateTimeISO(s.timezone).toPlainDate();
  while (Temporal.PlainDate.compare(date, last) <= 0 && result.length < limit) {
    if (s.frequency === 'daily' || s.weekdays.includes(date.dayOfWeek)) {
      const local = date.toPlainDateTime(s.local_time);
      const zoned = local.toZonedDateTime(s.timezone, { disambiguation: 'earlier' });
      const instant = zoned.toInstant();
      if (zoned.toPlainDateTime().equals(local) && Temporal.Instant.compare(instant, start) >= 0 && Temporal.Instant.compare(instant, end) < 0) result.push(instant.toString());
    }
    date = date.add({ days: 1 });
  }
  return result;
}
export function upcoming(s: ScheduleInput, now = new Date().toISOString()) {
  return occurrences(s, now, Temporal.Instant.from(now).add({ hours: 24 * 40 }).toString(), 5);
}
export function renderMessage(body: string, scheduledAt: string, timezone: string, values: { venue: string; match_time: string }) {
  const date = Temporal.Instant.from(scheduledAt).toZonedDateTimeISO(timezone).toPlainDate();
  const sunday = date.add({ days: 7 - date.dayOfWeek || 7 });
  const variables: Record<string, string> = {
    ...values,
    next_sunday_date: sunday.toLocaleString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  };
  const rendered = body.replace(/{{\s*([^{}]+?)\s*}}/g, (_, key: string) => {
    if (!Object.hasOwn(variables, key) || !variables[key].trim()) throw new Error(`Missing or unknown variable: ${key}`);
    return variables[key];
  });
  if (rendered.includes('{{') || rendered.includes('}}')) throw new Error('Invalid placeholder');
  if (!rendered.trim()) throw new Error('Message is empty');
  return rendered;
}
export function dispatchDecision(scheduledAt: string, now: number): 'wait' | 'send' | 'missed' {
  const delay = now - Date.parse(scheduledAt);
  return delay < 0 ? 'wait' : delay > 5000 ? 'missed' : 'send';
}
export const signupTemplate = `⚽ *OU Soccer – Weekly Signup*

📰 Please add your name, including pre-paid players, to confirm your availability. Others can also sign up to fill available spots. The final list will be shared based on player priority.

*Date:* {{next_sunday_date}}
*Time:* 7 AM – 9 AM
*Max:* 21 Players
*Format:* 7v7 – 3 Teams

*Drop-in:* $13
*Interac:* jahirhstu2@gmail.com

*Here are the boys*
1.
2.
3.
4.

*Waitlist (those who did not sign up for the season)*
1.

*Address:*
Bell Sensplex
1565 Maple Grove Rd, Stittsville

*Check status:* https://ou-soccer-manager.vercel.app/

*Note:* Headcount opens every Monday at 9 PM!

*Team building:* Thursday night (InshaAllah)`;
