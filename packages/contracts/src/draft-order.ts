// Same balanced pick-order rules as the website team builder.
export function balancedDraftRounds<T extends { key: string }>(teams: T[], count: number): T[][] {
  if (!teams.length) return [];
  if (teams.length === 3) {
    const patterns = [[0,1,2],[2,1,0],[1,0,2],[0,1,2],[0,2,1],[1,2,0],[2,0,1],[2,1,0]];
    return Array.from({length:count},(_,i)=>patterns[i%patterns.length].map(index=>teams[index]));
  }
  function permutations(values: T[]): T[][] {
    if (values.length<=1) return [values];
    return values.flatMap((value,index)=>permutations([...values.slice(0,index),...values.slice(index+1)]).map(rest=>[value,...rest]));
  }
  const candidates=permutations(teams);
  const counts=new Map(teams.map(team=>[team.key,Array.from({length:teams.length},()=>0)]));
  const rounds:T[][]=[];
  for(let round=0;round<count;round++) {
    let best=candidates[0],bestScore=Infinity;
    for(const candidate of candidates) {
      const score=candidate.reduce((total,team,position)=>total+((counts.get(team.key)?.[position]??0)+1)**2+(rounds.at(-1)?.[position]?.key===team.key?2:0),0);
      if(score<bestScore) {best=candidate;bestScore=score;}
    }
    best.forEach((team,position)=>{counts.get(team.key)![position]++;});rounds.push(best);
  }
  return rounds;
}
