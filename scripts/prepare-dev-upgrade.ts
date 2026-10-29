import { readFileSync,readdirSync,writeFileSync,mkdirSync } from "node:fs";
import { localDatabase } from "./demo/local-database";
import { fingerprint,snapshot,upgradeVersions,sha256 } from "./demo/maintenance";
import { attributionLinks } from "./demo/schema";

async function main() {
  const inspected=JSON.parse(readFileSync('dev-database.local.json','utf8'));
  const db=await localDatabase();
  try {
    const files=readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort();
    for(const file of files) await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
    const target=await snapshot(async q=>(await db.query(q)).rows as Record<string,unknown>[]);
    const selected=files.filter(f=>upgradeVersions.includes(f.split('_')[0]));
    const winner=(target.functions as {name:string;definition:string}[]).find(f=>f.name==='public_latest_session_winner')!;
    const constraints=(target.constraints as {table_name:string;name:string;definition:string}[]);
    const repairs=attributionLinks.map(([table,column])=>{
      const name=`${table}_${column}_fkey`, c=constraints.find(c=>c.name===name)!;
      return `alter table public.${table} add constraint ${name} ${c.definition};`;
    });
    const grants=(target.functionPrivileges as Record<string,unknown>[]).flatMap(row=>{
      const signature=`public.${row.name}(${row.arguments})`;
      const before=(inspected.functionPrivileges as Record<string,unknown>[]).find(r=>r.name===row.name&&r.arguments===row.arguments);
      if(before&&['anon','authenticated','service_role'].every(role=>before[role]===row[role])) return [];
      const roles=['anon','authenticated','service_role'].filter(role=>row[role]);
      return [`revoke execute on function ${signature} from public,anon,authenticated,service_role;`,
        ...(roles.length?[`grant execute on function ${signature} to ${roles.join(',')};`]:[])];
    });
    const sql=["-- Development-only upgrade for the inspected pre-merge schema. Run through dev-database.ts.",
      "-- Existing data is preserved. Four legacy extra columns are intentionally retained.",
      winner.definition+';',...repairs,
      ...selected.map(file=>`-- SOURCE: ${file}\n${readFileSync(`supabase/migrations/${file}`,'utf8')}`),
      "revoke all on function public.public_player_report() from public,anon,authenticated;",
      "revoke all on function public.public_latest_session_winner(uuid) from public,anon,authenticated;"
      ,...grants
    ].join('\n\n');
    const tables=(target.tables as {name:string}[]).map(t=>t.name);
    const quote=(v:unknown):string=>v===null?'null':Array.isArray(v)?`array[${v.map(quote).join(',')}]::text[]`:typeof v==='boolean'?String(v):typeof v==='number'?String(v):`'${String(typeof v==='object'?JSON.stringify(v):v).replaceAll("'","''")}'`;
    const reference:string[]=[];
    for(const table of ['module_catalog','program_templates','program_template_modules']) {
      for(const row of (await db.query(`select * from public.${table}`)).rows as Record<string,unknown>[]) {
        reference.push(`insert into public.${table} (${Object.keys(row).map(k=>`"${k}"`).join(',')}) values (${Object.values(row).map(quote).join(',')});`);
      }
    }
    const cleanup=`-- DESTRUCTIVE: every public application row, including audit history and profiles.\n-- No CASCADE: unexpected external dependencies cause an error instead of being erased.\ntruncate table ${tables.map(t=>`public."${t}"`).join(', ')} restart identity restrict;\n${reference.join('\n')}\n`;
    mkdirSync('scripts/generated',{recursive:true});
    writeFileSync('scripts/generated/dev-upgrade.sql',sql);
    writeFileSync('scripts/generated/dev-cleanup.sql',cleanup);
    writeFileSync('scripts/generated/dev-maintenance.local.json',JSON.stringify({projectRef:inspected.projectRef,inspectedAt:inspected.inspectedAt,beforeFingerprint:fingerprint(inspected),upgradeHash:sha256(sql),cleanupHash:sha256(cleanup),target,files:files.map(file=>({file,hash:sha256(readFileSync(`supabase/migrations/${file}`,'utf8'))})),selected},null,2),{mode:0o600});
    console.log('Prepared upgrade and cleanup SQL. No remote connection or changes made.');
  } finally {await db.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
