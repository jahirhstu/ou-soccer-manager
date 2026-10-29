import { expect, it } from "vitest";
import { balancedDraftRounds } from "../../packages/contracts/src/draft-order";

it("preserves the website three-team balanced rotation",()=>{
  const teams=[{key:"a"},{key:"b"},{key:"c"}];
  expect(balancedDraftRounds(teams,4).map(round=>round.map(team=>team.key).join(""))).toEqual(["abc","cba","bac","abc"]);
});
it("includes each captain once in each balanced round",()=>{
  for(const size of [2,3,4,5,6]) {
    const teams=Array.from({length:size},(_,index)=>({key:String(index)}));
    const rounds=balancedDraftRounds(teams,12);
    for(const round of rounds) expect(new Set(round.map(team=>team.key)).size).toBe(size);
  }
  expect(balancedDraftRounds([],5)).toEqual([]);
});
