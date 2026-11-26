import { describe, expect, it } from 'vitest';
import { previewSignupAllocation, type SignupAllocationContext } from '../signup-allocation';
import type { ParsedWhatsAppImport } from '../types';

const context: SignupAllocationContext = {
  names: ['Guest', 'Arif', 'Other'],
  players: [
    { id: 'guest', display_name: 'Guest' },
    { id: 'arif', display_name: 'Arif' },
    { id: 'ros', display_name: 'Arif Ros' },
    { id: 'other', display_name: 'Other' }
  ],
  aliases: [], memberIds: ['arif'], capacity: 1
};
const parsed = {
  rawText: '1. Guest\n2. Arif\n3. Other', importType: 'session_update',
  players: context.names.map(name => ({ name, confidence: 'high' })),
  attendance: [], payments: [], warnings: [], teams: [], matches: [], goals: [], dropouts: [], confidence: 'high'
} as ParsedWhatsAppImport;
const statuses = (selections: Record<string, string>, scope = context) =>
  previewSignupAllocation(parsed, scope, selections).draft.rows.map(row => [row.name, row.status]);

describe('live signup allocation', () => {
  it('promotes the resolved season member and demotes the guest without parsing again', () => {
    expect(statuses({})).toEqual([['Guest', 'confirmed'], ['Arif', 'unresolved'], ['Other', 'waitlisted']]);
    const result = previewSignupAllocation(parsed, context, { Arif: 'arif' });
    expect(result.draft.needs_review).toBe(false);
    expect(result.parsed.attendance.map(row => [row.playerName, row.status])).toEqual([
      ['Guest', 'waitlisted'], ['Arif', 'confirmed'], ['Other', 'waitlisted']
    ]);
    expect(result.parsed.players.find(row => row.name === 'Arif')?.matchedPlayerId).toBe('arif');
    expect(parsed.attendance).toEqual([]);
  });

  it('revisits membership when switching players and preserves original signup order', () => {
    expect(statuses({ Arif: 'ros' })).toEqual([['Guest', 'confirmed'], ['Arif', 'waitlisted'], ['Other', 'waitlisted']]);
    expect(statuses({ Arif: 'arif' })[1]).toEqual(['Arif', 'confirmed']);
  });

  it('supports clearing, ignoring, restoring and explicitly creating a player', () => {
    const cleared = previewSignupAllocation(parsed, context, { Guest: '', Arif: '__ignore__' });
    expect(cleared.draft.needs_review).toBe(true);
    expect(cleared.draft.rows[0].status).toBe('unresolved');
    expect(cleared.parsed.players.map(row => row.name)).not.toContain('Arif');
    expect(context.names).toContain('Arif');
    expect(statuses({ Arif: 'arif' })[1][1]).toBe('confirmed');
    const created = previewSignupAllocation(parsed, context, { Arif: '__create__' });
    expect(created.draft.needs_review).toBe(false);
    expect(created.draft.rows[1]).toMatchObject({ player_id: '__new__:Arif', member: false, status: 'waitlisted' });
  });

  it('counts a duplicated identity once and blocks season membership overflow', () => {
    const duplicate = previewSignupAllocation(parsed, context, { Guest: 'arif', Arif: 'arif' });
    expect(duplicate.draft.rows.filter(row => row.player_id === 'arif')).toHaveLength(1);
    const overflow = previewSignupAllocation(parsed, { ...context, memberIds: ['arif', 'guest'] }, { Arif: 'arif' });
    expect(overflow.draft.overflow).toBe(true);
    expect(overflow.draft.needs_review).toBe(true);
  });
});
