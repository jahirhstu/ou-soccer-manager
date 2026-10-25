import { readFileSync,readdirSync,writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { schemaQueries } from "./demo/schema";
import { localDatabase } from "./demo/local-database";
const remote=JSON.parse(readFileSync("dev-database.local.json","utf8"));
const normalize=(v:unknown)=>JSON.stringify(v, (key,value)=>key==='acl'?undefined:typeof value==='string'?value.replace(/\s+/g,' ').trim():value);
async function main() {
  for(const baseline of [true,false]) {
    const db=await localDatabase();
    try {
      const files=baseline?execFileSync("git",["ls-tree","--name-only","8a10cb1","supabase/migrations/"],{encoding:"utf8"}).trim().split("\n"):readdirSync("supabase/migrations").filter(f=>f.endsWith(".sql")).sort().map(f=>`supabase/migrations/${f}`);
      for(const file of files) {
        try {await db.exec(baseline?execFileSync("git",["show",`8a10cb1:${file}`],{encoding:"utf8"}):readFileSync(file,"utf8"));}
        catch(e){throw new Error(`${file}: ${(e as Error).message}`);}
      }
      const diff:Record<string,unknown>={};
      for(const [section,query] of Object.entries(schemaQueries)) {
        const rows=((await db.query(query)).rows as Record<string,unknown>[]).filter(r=>section!=='constraints'||!String(r.definition).startsWith('NOT NULL'));
        const key=(r:Record<string,unknown>)=>[r.schema_name,r.table_name,r.column_name,r.name,r.arguments].filter(v=>v!==undefined).join("|");
        const expected=new Map(rows.map(r=>[key(r),r]));
        const actual=new Map((remote[section] as Record<string,unknown>[]).map(r=>[key(r),r]));
        const missing=[...expected.keys()].filter(k=>!actual.has(k));
        const extra=[...actual.keys()].filter(k=>!expected.has(k));
        const changed=[...expected.keys()].filter(k=>actual.has(k)&&normalize(expected.get(k))!==normalize(actual.get(k)));
        diff[section]={missing,extra,changed};
      }
      console.log(baseline?"PRE-MERGE BASELINE":"CURRENT DEVELOP",JSON.stringify(diff,null,2));
      writeFileSync(baseline?"/tmp/dev-baseline-diff.json":"/tmp/dev-target-diff.json",JSON.stringify(diff,null,2));
    } finally {await db.close();}
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
