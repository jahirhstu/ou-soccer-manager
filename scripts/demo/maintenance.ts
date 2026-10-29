import { createHash } from "node:crypto";
import { schemaQueries } from "./schema";

export const upgradeVersions = ["049","068","070","071","072","073","074","075","076","077","078","079","080","088","089","090","091","092","093","094","095"];
export const normalizeSchema = (value: unknown) => JSON.stringify(value, (key,v)=>
  key === 'acl' ? undefined : typeof v === 'string' ? v.replace(/\s+/g,' ').trim() : v);
export const fingerprint = (schema: Record<string,unknown>) => createHash('sha256').update(
  JSON.stringify(Object.keys(schemaQueries).map(key=>normalizeSchema(schema[key])))
).digest('hex');
export async function snapshot(query: (sql:string)=>Promise<Record<string,unknown>[]>) {
  const result:Record<string,unknown>={};
  for(const [key,sql] of Object.entries(schemaQueries)) {
    const rows=await query(sql);
    // PostgreSQL 18 exposes NOT NULL as constraints; PostgreSQL 17 uses attnotnull.
    result[key]=key==='constraints'?rows.filter(r=>!String(r.definition).startsWith('NOT NULL')):rows;
  }
  return result;
}
export const sha256=(text:string)=>createHash('sha256').update(text).digest('hex');
export function schemaDifferences(actual:Record<string,unknown>,target:Record<string,unknown>) {
  const differences:string[]=[];
  const legacy=new Set(['players|avatar_url','session_teams|score','sessions|team_a_score','sessions|team_b_score']);
  for(const section of Object.keys(schemaQueries)) {
    const key=(r:Record<string,unknown>)=>[r.schema_name,r.table_name,r.column_name,r.name,r.arguments].filter(v=>v!==undefined).join('|');
    const expected=new Map((target[section] as Record<string,unknown>[]).map(r=>[key(r),r]));
    const found=new Map((actual[section] as Record<string,unknown>[]).map(r=>[key(r),r]));
    for(const [k,row] of expected) if(normalizeSchema(found.get(k))!==normalizeSchema(row)) differences.push(`${section}: missing or changed ${k}`);
    for(const k of found.keys()) if(!expected.has(k)&&!(section==='columns'&&legacy.has(k))) differences.push(`${section}: unexpected ${k}`);
  }
  return differences;
}
