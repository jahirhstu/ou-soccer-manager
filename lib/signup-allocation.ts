import { allocateSignup } from "../packages/communications/src/signup-import";
import type { ImportIdentity, ImportAlias } from "../packages/contracts/src/import-identity";
import type { ParsedWhatsAppImport } from "./types";

export type SignupAllocationContext = { names: string[]; players: ImportIdentity[]; aliases: ImportAlias[]; memberIds: string[]; capacity: number };

export function previewSignupAllocation(parsed: ParsedWhatsAppImport, context: SignupAllocationContext, selections: Record<string, string>) {
  const players = [...context.players];
  const choices = {...selections};
  for (const [name, value] of Object.entries(choices)) {
    if (value === "__create__") {
      const id = `__new__:${name}`;
      players.push({id, display_name:name});
      choices[name] = id;
    }
  }
  const draft = allocateSignup(context.names, players, context.aliases, new Set(context.memberIds), context.capacity, choices);
  return {draft, parsed:applySignupAllocation(parsed, draft)};
}

/** Apply the shared allocation to a parser result; both UI and automatic confirmation use it. */
export function applySignupAllocation(parsed: ParsedWhatsAppImport, draft: ReturnType<typeof allocateSignup>) {
  const prepared = structuredClone(parsed);
  prepared.players = draft.rows.filter(row => row.status !== 'ignored').map(row => ({name:row.name,matchedPlayerId:row.player_id,confidence:'high'}));
  prepared.attendance = draft.rows.filter(row => row.status !== 'ignored').map(row => ({playerName:row.name,matchedPlayerId:row.player_id,status:row.status === 'confirmed' ? 'confirmed' : 'waitlisted',confidence:'high'}));
  prepared.payments=[];prepared.dropouts=[];prepared.teams=[];prepared.matches=[];prepared.goals=[];
  return prepared;
}
