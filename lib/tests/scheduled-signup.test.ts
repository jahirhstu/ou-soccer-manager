import { describe, expect, it, vi } from 'vitest';
import { allocateSignup, likelySignup, signupScheduleSchema, signupWindow } from '../../packages/communications/src/signup-import';
vi.mock('../actions/import-service', () => ({ parseWhatsAppText: vi.fn() }));
import { orderedSignupNames, selectSignupMessage } from '../signup-import-service';
import { RuleBasedWhatsAppParser } from '../parsers/rule-based';
const main = ['Wali','Rocky','Jahir','Ahmed','Arif','Sadat','Rafiul','Moshee','Arnab','Shihan','Shaiful','Shomi','Naveed'];
const waiting = ['Habib','Jamil','Jahid','Osamah','Mim','Muttahid','Tushar','Romi','Miraz','Rahim','Imon','Tanzil'];
const players = [...main, ...waiting].map((display_name, i) => ({ id: String(i), display_name }));
const message = `📰 Please add your name to confirm your availability.\n*Date:* Sunday, November 29, 2026\n*Time:* 7 AM – 9 AM\n*Max:* 21 Players\n*Drop-in:* $13\n*Here are the boys*\n${main.map((n, i) => `${i + 1}. ⁠${n}`).join('\n')}\n*Waitlist (those who did not sign up for the season)*\n${waiting.map((n, i) => `${i + 1}. ${n}${n === 'Rahim' ? ' (yes I am back insaaAllah)' : ''}`).join('\n')}\n*Address:*\nBell Sensplex\n1565 Maple Grove Rd, Stittsville`;
const schedule = signupScheduleSchema.parse({ name: 'Import', season_id: '10000000-0000-4000-8000-000000000001', destination_id: '20000000-0000-4000-8000-000000000001', timezone: 'America/Toronto', weekday: 4, local_time: '20:00:00' });
describe('scheduled signup allocation', () => {
  it('allocates the supplied 13 + 12 roster into 21 confirmed and four waitlisted', () => {
    const result = allocateSignup([...main, ...waiting], players, [], new Set(players.slice(0, 13).map(p => p.id)), 21);
    expect(result.needs_review).toBe(false);
    expect(result.rows.filter(r => r.status === 'confirmed')).toHaveLength(21);
    expect(result.rows.filter(r => r.status === 'waitlisted').map(r => r.name)).toEqual(['Miraz','Rahim','Imon','Tanzil']);
  });
  it('prioritizes listed members even in the waitlist and excludes absent members', () => {
    const result = allocateSignup(['Wali','Rocky','Tanzil'], players, [], new Set(['24','2']), 2);
    expect(result.rows.find(r => r.name === 'Tanzil')?.status).toBe('confirmed');
    expect(result.rows.find(r => r.name === 'Rocky')?.status).toBe('waitlisted');
    expect(result.rows.some(r => r.name === 'Jahir')).toBe(false);
  });
  it('holds ambiguous and unknown identities, then recalculates after selection', () => {
    const names = [{ id: '1', display_name: 'Rafi' }, { id: '2', display_name: 'Rafiul' }, { id: '3', display_name: 'Guest' }];
    expect(allocateSignup(['Rafi','Unknown'], names, [], new Set(), 21).rows.every(r => r.status === 'unresolved')).toBe(true);
    const draft = allocateSignup(['Guest','Rafi'], names, [], new Set(['2']), 1, { Rafi: '2' });
    expect(draft.needs_review).toBe(false);
    expect(draft.rows.find(r => r.name === 'Guest')?.status).toBe('waitlisted');
    expect(allocateSignup(['Rafiul'], names, [], new Set(), 21).rows[0].player_id).toBe('2');
  });
  it('deduplicates identities, accepts ignores, and holds season-member overflow', () => {
    expect(allocateSignup(['Wali','Wallie'], players, [{ player_id: '0', alias_name: 'Wallie' }], new Set(), 21).rows).toHaveLength(1);
    expect(allocateSignup(['Unknown'], players, [], new Set(), 21, { Unknown: '__ignore__' }).needs_review).toBe(false);
    expect(allocateSignup(main, players, [], new Set(players.map(p => p.id)), 2).overflow).toBe(true);
    expect(() => allocateSignup(['Wali'], players, [], new Set(), 21, { Wali: 'foreign' })).toThrow('Invalid player');
  });
  it('requires exact identity evidence rather than accepting a unique substring suggestion', () => {
    expect(allocateSignup(['Rafi'], [{ id: 'one', display_name: 'Rafiul' }], [], new Set(), 21).needs_review).toBe(true);
  });
});
describe('message selection and contract parsing', () => {
  const parser = new RuleBasedWhatsAppParser();
  const from = '2026-11-24T02:00:00Z', until = '2026-11-27T01:00:00Z';
  const msg = (id: string, body = message, timestamp = Date.parse('2026-11-26T22:00:00Z') / 1000) => ({ id, body, timestamp });
  it('parses the supplied formatting and strips the Rahim annotation', async () => {
    expect(likelySignup(message)).toBe(true);
    const { parsed, source } = await selectSignupMessage([msg('list')], '2026-11-29', from, until, input => parser.parse(input));
    expect(parsed.players.map(p => p.name)).toEqual([...main, ...waiting]);
    expect(parsed.attendance.filter(p => p.status === 'waitlisted')).toHaveLength(12);
    expect(source.hash).toHaveLength(64);
  });
  it('selects the newest repost, skips unrelated chatter and another session date', async () => {
    const result = await selectSignupMessage([msg('old', message, Date.parse('2026-11-25T22:00:00Z') / 1000), msg('new'), msg('other', message.replace('November 29', 'December 6'), Date.parse('2026-11-26T23:00:00Z') / 1000), msg('chat', 'Can someone bring a ball?')], '2026-11-29', from, until, input => parser.parse(input));
    expect(result.source.id).toBe('new');
  });
  it('does not fall back to an older message when the newest parser call fails', async () => {
    const parse = vi.fn().mockRejectedValue(new Error('Parser unavailable'));
    await expect(selectSignupMessage([msg('old', message, Date.parse('2026-11-25T22:00:00Z') / 1000), msg('new')], '2026-11-29', from, until, parse)).rejects.toThrow('Parser unavailable');
    expect(parse).toHaveBeenCalledTimes(1);
  });
  it('uses the source list order, rejects omitted names, and detects timestamp conflicts', async () => {
    expect(orderedSignupNames('1. Wali\n2. ⁠Rahim (yes I am back insaaAllah)', ['Rahim','Wali'])).toEqual(['Wali','Rahim']);
    expect(() => orderedSignupNames('1. Wali\n2. Rocky', ['Wali'])).toThrow('did not preserve');
    await expect(selectSignupMessage([msg('a'), msg('b', message + '\nUpdated list')], '2026-11-29', from, until, input => parser.parse(input))).rejects.toThrow('same timestamp');
  });
});
describe('weekly import windows', () => {
  it('targets Sunday and opens Monday at 9 PM Toronto', () => {
    expect(signupWindow(schedule, '2026-11-27T01:00:00Z')).toEqual({ target_date: '2026-11-29', from: '2026-11-24T02:00:00Z', until: '2026-11-27T01:00:00Z' });
  });
  it('uses local calendar days across daylight saving changes and same-day sessions', () => {
    expect(signupWindow({ ...schedule, session_weekday: 7 }, '2026-11-01T15:00:00Z')).toEqual({ target_date: '2026-11-01', from: '2026-10-27T01:00:00Z', until: '2026-11-01T15:00:00Z' });
    expect(signupScheduleSchema.safeParse({ ...schedule, timezone: 'bad/timezone' }).success).toBe(false);
  });
});
