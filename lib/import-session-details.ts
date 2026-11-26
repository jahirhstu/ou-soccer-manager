/** Human-readable imported session names use the calendar date, without timezone conversion. */
export function importedSessionName(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== date) throw new Error('Invalid session date');
  const day = value.getUTCDate();
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? 'th' : ({1:'st',2:'nd',3:'rd'} as Record<number,string>)[day % 10] ?? 'th';
  return `${value.toLocaleString('en-CA', {month:'long', timeZone:'UTC'})} ${day}${suffix}`;
}
export function matchExistingImportPlayground<T extends {id:string;name:string}>(location: string, playgrounds: T[], rawText = ''): T | undefined {
  const words = (value:string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(/\s+/).filter(Boolean);
  const same = (a:string[],b:string[]) => a.join(' ') === b.join(' ');
  const input = words(location);
  const exact = playgrounds.filter(p => same(words(p.name),input));
  if (exact.length) return exact.length === 1 ? exact[0] : undefined;
  const contained = (name:string[],text:string[]) => {
    let cursor=0;
    for (const token of name) { const index=text.indexOf(token,cursor); if(index<0)return false;cursor=index+1; }
    return name.length>0;
  };
  for (const text of [input,words(rawText)]) {
    const matches=playgrounds.filter(p=>contained(words(p.name),text));
    if(matches.length) return matches.length===1?matches[0]:undefined;
  }
  return undefined;
}
