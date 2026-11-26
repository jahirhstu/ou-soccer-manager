import { beforeEach, expect, it, vi } from 'vitest';
const parser = vi.hoisted(() => vi.fn());
vi.mock('../parsers', () => ({ whatsappParser: { parse: parser } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { parseWhatsAppText } from '../actions/import-service';
import { orderedSignupNames } from '../signup-import-service';
import { RuleBasedWhatsAppParser } from '../parsers/rule-based';
import type { ParsedWhatsAppImport } from '../types';
const header = '*Date:* Sunday, November 29, 2026\n*Here are the boys*\n1. Wali\n*Waitlist (those who did not sign up for the season)*\n1. ⁠Habib';
function llmResult(rawText: string): ParsedWhatsAppImport {
  return {rawText,importType:'session_update',confidence:'high',session:{date:'2026-11-29'},players:[{name:'Wali',confidence:'high'},{name:'Habib',confidence:'high'}],payments:[],attendance:[],dropouts:[],teams:[],matches:[],goals:[],warnings:[]};
}
beforeEach(() => { parser.mockReset(); });
it('does not append a street address after the formatted Address heading to an LLM roster', async () => {
  const raw = `${header}\n*Address:*\nBell Sensplex\n1565 Maple Grove Rd, Stittsville`;
  parser.mockResolvedValue(llmResult(raw));
  const parsed = await parseWhatsAppText(raw);
  expect(parsed.players.map(p => p.name)).toEqual(['Wali','Habib']);
  expect(orderedSignupNames(raw, parsed.players.map(p => p.name))).toEqual(['Wali','Habib']);
  expect(parsed.attendance).toContainEqual(expect.objectContaining({playerName:'Habib',status:'waitlisted'}));
});
it.each(['*Address:*','_Location:_','*Venue:*'])('stops waitlist extraction at %s including short street numbers', async heading => {
  const raw = `${header}\n${heading}\n15 Maple Grove Rd, Stittsville`;
  parser.mockResolvedValue(llmResult(raw));
  expect((await parseWhatsAppText(raw)).players.map(p => p.name)).toEqual(['Wali','Habib']);
});
it('does not consume the first three digits of a four-digit street number as a list index', async () => {
  const raw = `${header}\n1565 Maple Grove Rd, Stittsville`;
  parser.mockResolvedValue(llmResult(raw));
  expect((await parseWhatsAppText(raw)).players.map(p => p.name)).toEqual(['Wali','Habib']);
});
it('keeps the complete rule-based and shared normalization path consistent with the numbered source', async () => {
  const raw = `${header}\n*Address:*\nBell Sensplex\n1565 Maple Grove Rd, Stittsville`;
  parser.mockImplementation(input => new RuleBasedWhatsAppParser().parse(input));
  const parsed = await parseWhatsAppText(raw);
  expect(parsed.players.map(p => p.name)).toEqual(['Wali','Habib']);
  expect(orderedSignupNames(raw, parsed.players.map(p => p.name))).toEqual(['Wali','Habib']);
});

const intro = '📰 Please add your name, including pre-paid players, to confirm your availability. Others can also sign up to fill available spots. The final list will be shared based on player priority.';
it('does not turn signup announcement prose into player names in the rule-based path', async () => {
  const raw = `${intro}\n\n${header}\n*Address:*\nBell Sensplex\n1565 Maple Grove Rd, Stittsville`;
  parser.mockImplementation(input => new RuleBasedWhatsAppParser().parse(input));
  const parsed = await parseWhatsAppText(raw);
  expect(parsed.players.map(p => p.name)).toEqual(['Wali','Habib']);
  expect(parsed.attendance.some(row => ['Please','Others','The'].includes(row.playerName))).toBe(false);
});
it('uses the numbered signup roster when an LLM also infers names from introductory prose', () => {
  expect(orderedSignupNames(`${intro}\n${header}`, ['Please','Others','The','Wali','Habib'])).toEqual(['Wali','Habib']);
});
it('still rejects a parsed roster that misses a real numbered player', () => {
  expect(() => orderedSignupNames(`${intro}\n${header}`, ['Please','Others','The','Wali'])).toThrow('did not preserve the numbered roster entry: Habib');
});
