export type PitchPosition = { slot: string; label: string; playerId?: string; x: number; y: number; jerseyColor?: string };

export function formationPositions(formation: string): PitchPosition[] {
  return [1, ...formation.split("-").map(Number)].flatMap((count, layer) => Array.from({ length: count }, (_, index) => ({
    slot: `${layer}-${index}`, label: layer === 0 ? "GK" : `${["", "D", "M", "F"][layer]}${index + 1}`,
    x: [10, 30, 56, 82][layer], y: 50 + (index - (count - 1) / 2) * Math.min(72 / Math.max(count - 1, 1), 24)
  })));
}

// Saved website lineups may contain assigned positions only, including custom slots.
export function restorePositions(formation: string, saved: PitchPosition[]): PitchPosition[] {
  const template = formationPositions(formation);
  const remaining = [...template];
  const result = saved.map(position => {
    const exact = remaining.findIndex(value => value.slot === position.slot);
    if (exact >= 0) remaining.splice(exact, 1);
    else remaining.shift();
    return position;
  });
  return [...result, ...remaining];
}

export function fixturePreview(teams: { id: string; name: string }[], repeats: number, avoid: string) {
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 20 || teams.length < 2 || teams.length > 12) return [];
  const sorted = [...teams].sort((a,b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const pairs: { home: typeof sorted[number]; away: typeof sorted[number] }[] = [];
  sorted.forEach((home,i) => sorted.slice(i+1).forEach(away => pairs.push({home,away})));
  const first = avoid ? pairs.findIndex(pair => pair.home.id !== avoid && pair.away.id !== avoid) : -1;
  if (first > 0) pairs.unshift(...pairs.splice(first,1));
  if (pairs.length * repeats > 1000) return [];
  return Array.from({length:repeats},(_,round)=>pairs.map(pair => ({
    home: round % 2 ? pair.away : pair.home, away: round % 2 ? pair.home : pair.away, round: round + 1
  }))).flat();
}
