/** Human-readable imported session names use the calendar date, without timezone conversion. */
export function importedSessionName(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== date) throw new Error('Invalid session date');
  const day = value.getUTCDate();
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? 'th' : ({1:'st',2:'nd',3:'rd'} as Record<number,string>)[day % 10] ?? 'th';
  return `${value.toLocaleString('en-CA', {month:'long', timeZone:'UTC'})} ${day}${suffix}`;
}
export function importPlaygroundCandidates<T extends {id:string;name:string}>(location: string, playgrounds: T[], rawText = ''): T[] {
  const normalized = (value:string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const input = normalized(location);
  // Ordered venue words also cover addresses inserted between the venue and suburb.
  const containsWords = (name:string, text:string) => {
    let cursor = 0;
    const tokens = text.split(' ');
    for (const token of name.split(' ')) {
      const index = tokens.indexOf(token, cursor);
      if (index < 0) return false;
      cursor = index + 1;
    }
    return Boolean(name);
  };
  const matches = input ? playgrounds.filter(p => {
    const name = normalized(p.name);
    return Boolean(name) && (input.includes(name) || name.includes(input) || containsWords(name,input));
  }) : [];
  if (matches.length) return matches;
  const text = normalized(rawText);
  return text ? playgrounds.filter(p => containsWords(normalized(p.name),text)) : [];
}

export function matchExistingImportPlayground<T extends {id:string;name:string}>(location: string, playgrounds: T[], rawText = ''): T | undefined {
  const matches = importPlaygroundCandidates(location, playgrounds, rawText);
  return matches.length === 1 ? matches[0] : undefined;
}
/** Normalize imported clock times before previewing or writing PostgreSQL time fields. */
export function normalizeImportedTime(value?: string | null): string | undefined {
  const text = value?.normalize('NFKC').trim();
  if (!text) return undefined;
  const match = text.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) throw new Error('Invalid imported time; use HH:MM format.');
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const second = Number(match[3] ?? 0);
  const period = match[4]?.toUpperCase();
  if (minute > 59 || second > 59 || (period ? hour < 1 || hour > 12 : hour > 23)) {
    throw new Error('Invalid imported time; use HH:MM format.');
  }
  if (period) hour = hour % 12 + (period === 'PM' ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}${match[3] ? `:${match[3]}` : ''}`;
}
