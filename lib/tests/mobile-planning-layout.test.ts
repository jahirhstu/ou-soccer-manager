import { describe, expect, it } from "vitest";
import { fixturePreview, formationPositions, restorePositions } from "../../packages/match-day/src/planning-layout";

describe("native planning presentation",()=>{
  const teams=[{id:"a",name:"Alpha"},{id:"b",name:"Bravo"},{id:"c",name:"Charlie"}];
  it("restores empty slots without losing saved player positions or colours",()=>{
    const saved={slot:"0-0",label:"GK",x:8,y:50,playerId:"keeper",jerseyColor:"#FFF"};
    const restored=restorePositions("2-2-2",[saved]);
    expect(restored).toHaveLength(7);
    expect(restored[0]).toEqual(saved);
    expect(new Set(restored.map(p=>p.slot)).size).toBe(7);
  });
  it("preserves website custom positions and fills remaining formation slots",()=>{
    const saved={slot:"custom-1",label:"",x:47,y:81,playerId:"p1"};
    expect(restorePositions("4-3-3",[saved])).toHaveLength(11);
    expect(restorePositions("4-3-3",[saved])[0]).toEqual(saved);
  });
  it("places each supported formation inside the field",()=>{
    for(const formation of ["2-1-1","2-2-1","2-2-2","3-3-1","3-3-2","3-3-3","4-3-3"]){
      const positions=formationPositions(formation);
      expect(positions).toHaveLength(1+formation.split("-").reduce((sum,n)=>sum+Number(n),0));
      expect(positions.every(p=>p.x>=0&&p.x<=100&&p.y>=0&&p.y<=100)).toBe(true);
    }
  });
  it("previews repeated matchups with alternating home and away",()=>{
    const games=fixturePreview(teams,2,"");
    expect(games).toHaveLength(6);
    expect(games[3].home.id).toBe(games[0].away.id);
    expect(games[3].away.id).toBe(games[0].home.id);
    expect(games.every(g=>g.home.id!==g.away.id)).toBe(true);
  });
  it("respects first-game rest preference without dropping matchups",()=>{
    const games=fixturePreview(teams,1,"a");
    expect(games[0].home.id).toBe("b");expect(games[0].away.id).toBe("c");
    expect(games).toHaveLength(3);
  });
  it("rejects invalid or excessive previews",()=>{
    expect(fixturePreview(teams,NaN,"")).toEqual([]);
    expect(fixturePreview(teams,21,"")).toEqual([]);
    expect(fixturePreview(teams.slice(0,1),2,"")).toEqual([]);
    expect(fixturePreview(Array.from({length:12},(_,i)=>({id:String(i),name:String(i)})),20,"")).toEqual([]);
  });
});
