import { expect,it } from 'vitest';
import { importedSessionName,matchExistingImportPlayground,importPlaygroundCandidates } from '../import-session-details';
it.each([['2026-11-29','November 29th'],['2026-12-01','December 1st'],['2026-12-02','December 2nd'],['2026-12-03','December 3rd'],['2026-12-11','December 11th'],['2026-12-12','December 12th'],['2026-12-13','December 13th'],['2026-12-21','December 21st']])('names %s as %s',(date,name)=>expect(importedSessionName(date)).toBe(name));
it('rejects invalid dates',()=>expect(()=>importedSessionName('2026-02-30')).toThrow('Invalid session date'));
const grounds=[{id:'one',name:'Bell Sensplex Stittsville'},{id:'two',name:'Bells Sensplex'},{id:'three',name:'Ottawa Megadome'}];
it('matches canonical venue words across a street address',()=>expect(matchExistingImportPlayground('Bell Sensplex 1565 Maple Grove Rd, Stittsville',grounds)).toEqual(grounds[0]));
it('prefers exact names and does not guess ambiguous matches',()=>{
 expect(matchExistingImportPlayground('BELLS SENSPLEX',grounds)).toEqual(grounds[1]);
 expect(matchExistingImportPlayground('Bell Sensplex Stittsville',[...grounds,{id:'other',name:'Bell Sensplex Stittsville'}])).toBeUndefined();
 expect(matchExistingImportPlayground('Unknown venue',grounds)).toBeUndefined();
});

it('matches partial names in either direction and normalizes punctuation',()=>{
 expect(matchExistingImportPlayground('Ottawa',grounds)).toEqual(grounds[2]);
 expect(matchExistingImportPlayground('OTTAWA--MEGADOME, 123 Road',grounds)).toEqual(grounds[2]);
 expect(importPlaygroundCandidates('Sensplex',grounds)).toEqual(grounds.slice(0,2));
});
it('does not prefer an exact match over another partial match',()=>{
 const venues=[{id:'one',name:'Bell Sensplex'},{id:'two',name:'Bell Sensplex East'}];
 expect(importPlaygroundCandidates('Bell Sensplex',venues)).toHaveLength(2);
 expect(matchExistingImportPlayground('Bell Sensplex',venues)).toBeUndefined();
});
it('uses message fallback only when the location has no matches',()=>{
 expect(matchExistingImportPlayground('Unknown',grounds,'Address: Ottawa Megadome')).toEqual(grounds[2]);
 expect(matchExistingImportPlayground('Bells Sensplex',grounds,'Ottawa Megadome')).toEqual(grounds[1]);
 expect(importPlaygroundCandidates('',grounds,'')).toEqual([]);
});
