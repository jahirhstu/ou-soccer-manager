import { createHash } from 'node:crypto';
import { refreshTables, preservedTables } from '../../lib/production-refresh';

export type Query = (sql: string, values?: any[]) => Promise<any[]>;
type Column = { name: string; type: string; required: boolean; default_value: string | null };
export type TableData = { name: string; columns: Column[]; keys: string[]; json: string; count: number };
export type Snapshot = { organizationId: string; tables: TableData[] };
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const ident = (value: string) => '"' + value.replaceAll('"', '""') + '"';
export const fail = (message: string): never => { throw new Error(message); };

export async function inventory(q: Query) {
  const names = (await q("select tablename from pg_tables where schemaname='public' order by tablename")).map(r => r.tablename as string);
  const known = new Set<string>([...refreshTables, ...preservedTables]);
  if (names.some(name => !known.has(name))) fail('Unreviewed application tables found. Update the refresh manifest first.');
  const output: Omit<TableData, 'json' | 'count'>[] = [];
  for (const name of refreshTables) {
    if (!names.includes(name)) {
      // Older production sources do not yet contain the additive performance tables.
      if (['match_player_positions','session_performance_voting','captain_performance_votes','performance_changes'].includes(name)) continue;
      fail(`Required table is missing: ${name}`);
    }
    const columns = await q(`select a.attname name,format_type(a.atttypid,a.atttypmod) type,a.attnotnull required,
      pg_get_expr(d.adbin,d.adrelid) default_value from pg_attribute a
      left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=$1::regclass and a.attnum>0 and not a.attisdropped order by a.attname`, [`public.${name}`]);
    const keys = await q(`select a.attname name from pg_constraint c cross join lateral unnest(c.conkey) with ordinality k(n,pos)
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.n where c.conrelid=$1::regclass and c.contype='p' order by k.pos`, [`public.${name}`]);
    if (!keys.length) fail(`Missing primary key: ${name}`);
    output.push({ name, columns, keys: keys.map(r => r.name) });
  }
  return output;
}

function scope(table: Pick<TableData, 'name' | 'columns'>) {
  if (table.columns.some(c => c.name === 'organization_id')) return 't.organization_id=$1::uuid';
  if (table.name === 'session_team_update_events') return 'exists(select 1 from public.sessions s where s.id=t.session_id and s.organization_id=$1::uuid)';
  if (['session_performance_voting','captain_performance_votes','performance_changes'].includes(table.name)) return 'exists(select 1 from public.sessions s where s.id=t.session_id and s.organization_id=$1::uuid)';
  if (table.name === 'match_player_positions') return 'exists(select 1 from public.session_matches m join public.sessions s on s.id=m.session_id where m.id=t.match_id and s.organization_id=$1::uuid)';
  return fail(`No reviewed organization scope: ${table.name}`);
}

export async function capture(q: Query, organizationId: string): Promise<Snapshot> {
  if (!(await q('select id from public.organizations where id=$1', [organizationId])).length) fail('Organization UUID must already exist in both environments.');
  const tables: TableData[] = [];
  for (const table of await inventory(q)) {
    // Keep numeric values as PostgreSQL JSON text, never as JavaScript numbers.
    const [row] = await q(`select coalesce(jsonb_agg(to_jsonb(t) order by ${table.keys.map(k => 't.' + ident(k)).join(',')}),'[]'::jsonb)::text json,
      count(*)::int count from public.${ident(table.name)} t where ${scope(table)}`, [organizationId]);
    tables.push({ ...table, json: row.json, count: row.count });
  }
  return { organizationId, tables };
}

export function compatible(source: Snapshot, target: Snapshot) {
  if (source.organizationId !== target.organizationId) fail('Organization mapping mismatch.');
  for (const table of source.tables) {
    const other = target.tables.find(t => t.name === table.name) ?? fail(`Missing table: ${table.name}`);
    if (digest(table.keys) !== digest(other.keys)) fail(`Primary key mismatch: ${table.name}`);
    for (const column of table.columns) {
      if (other.columns.find(c => c.name === column.name)?.type !== column.type) fail(`Schema mismatch: ${table.name}.${column.name}`);
    }
    for (const column of other.columns) {
      if (!table.columns.some(c => c.name === column.name) && column.required && !column.default_value) fail(`Migration required: ${table.name}.${column.name}`);
    }
  }
}

export async function protectedHashes(q: Query, organizationId: string) {
  const data: Record<string, string> = {};
  const tables = await inventory(q);
  const names = (await q("select tablename from pg_tables where schemaname='public' order by tablename")).map(r => r.tablename);
  for (const name of names) {
    // Job state is the audit trail for the refresh itself.
    if (name === 'development_refresh_jobs') continue;
    const table = tables.find(t => t.name === name);
    const [row] = await q(`select md5(coalesce(string_agg(h,'' order by h),'')) hash from
      (select md5(to_jsonb(t)::text) h from public.${ident(name)} t ${table ? `where not (${scope(table)}) or (${scope(table)}) is null` : ''}) x`, table ? [organizationId] : []);
    data[name] = row.hash;
  }
  for (const name of ['users','identities']) {
    data[`auth.${name}`] = (await q(`select md5(coalesce(string_agg(h,'' order by h),'')) hash from
      (select md5(to_jsonb(t)::text) h from auth.${ident(name)} t) x`))[0].hash;
  }
  return data;
}

export async function validateReferences(q: Query) {
  const links = await q(`select c.conname name,n.nspname schema,t.relname child,pn.nspname parent_schema,p.relname parent,c.confmatchtype match,
    array(select a.attname from unnest(c.conkey) with ordinality k(n,pos) join pg_attribute a on a.attrelid=t.oid and a.attnum=k.n order by k.pos) child_keys,
    array(select a.attname from unnest(c.confkey) with ordinality k(n,pos) join pg_attribute a on a.attrelid=p.oid and a.attnum=k.n order by k.pos) parent_keys
    from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    join pg_class p on p.oid=c.confrelid join pg_namespace pn on pn.oid=p.relnamespace where c.contype='f' and n.nspname='public'`);
  const columns = await q("select table_name,column_name from information_schema.columns where table_schema='public'");
  const has = (table: string, column: string) => columns.some(r => r.table_name === table && r.column_name === column);
  for (const link of links) {
    if (link.match !== 's') fail('Unreviewed foreign-key matching mode.');
    const nonnull = link.child_keys.map((k: string) => `c.${ident(k)} is not null`).join(' and ');
    const equal = link.child_keys.map((k: string, i: number) => `c.${ident(k)}=p.${ident(link.parent_keys[i])}`).join(' and ');
    const bad = (await q(`select exists(select 1 from public.${ident(link.child)} c where ${nonnull} and not exists
      (select 1 from ${ident(link.parent_schema)}.${ident(link.parent)} p where ${equal})) bad`))[0].bad;
    if (bad) fail(`Missing dependency: ${link.child}.${link.name}. Accounts, memberships and programs are never created by refresh.`);
    if (link.parent_schema === 'public' && has(link.child, 'organization_id') && has(link.parent, 'organization_id')) {
      const mismatch = (await q(`select exists(select 1 from public.${ident(link.child)} c join public.${ident(link.parent)} p on ${equal}
        where c.organization_id is distinct from p.organization_id) bad`))[0].bad;
      if (mismatch) fail(`Cross-organization reference: ${link.child}.${link.name}`);
      if (has(link.child, 'program_id') && has(link.parent, 'program_id')) {
        const wrongProgram = (await q(`select exists(select 1 from public.${ident(link.child)} c join public.${ident(link.parent)} p on ${equal}
          where c.program_id is not null and p.program_id is not null and c.program_id<>p.program_id) bad`))[0].bad;
        if (wrongProgram) fail(`Cross-program reference: ${link.child}.${link.name}`);
      }
    }
  }
}

export async function replace(q: Query, source: Snapshot, before: Snapshot, normalizePrograms = true) {
  compatible(source, before);
  const protectedBefore = await protectedHashes(q, before.organizationId);
  // Suppress business side effects and FK cascades; validate all references before commit.
  await q('set local session_replication_role=replica');
  for (const table of before.tables) {
    await q(`delete from public.${ident(table.name)} t using jsonb_populate_recordset(null::public.${ident(table.name)},$1::jsonb) old
      where ${table.keys.map(k => `t.${ident(k)}=old.${ident(k)}`).join(' and ')}`, [table.json]);
  }
  for (const table of source.tables) {
    const columns = table.columns.map(c => ident(c.name)).join(',');
    await q(`insert into public.${ident(table.name)}(${columns}) select ${columns}
      from jsonb_populate_recordset(null::public.${ident(table.name)},$1::jsonb)`, [table.json]);
  }
  // Derive historical program scope from the existing parent, without changing money or IDs.
  for (const table of source.tables.filter(t => normalizePrograms && t.columns.some(c => c.name === 'program_id'))) {
    const parent = table.columns.some(c => c.name === 'season_id') ? 'seasons'
      : table.columns.some(c => c.name === 'league_id') ? 'leagues'
      : table.columns.some(c => c.name === 'session_id') && table.name !== 'sessions' ? 'sessions' : null;
    if (!parent) continue;
    const key = parent === 'sessions' ? 'session_id' : parent === 'leagues' ? 'league_id' : 'season_id';
    await q(`update public.${ident(table.name)} c set program_id=p.program_id from public.${parent} p
      where c.${key}=p.id and c.organization_id=$1 and c.program_id is null`, [source.organizationId]);
    if ((await q(`select exists(select 1 from public.${ident(table.name)} c join public.${parent} p on c.${key}=p.id
      where c.organization_id=$1 and c.program_id is distinct from p.program_id) bad`, [source.organizationId]))[0].bad) fail(`Conflicting program scope: ${table.name}`);
  }
  await q('set local session_replication_role=origin');
  await validateReferences(q);
  const after = await capture(q, source.organizationId);
  for (const table of source.tables) {
    const current = after.tables.find(t => t.name === table.name)!;
    // SQL compares JSON with numeric precision intact. Only the reviewed scope backfill may differ.
    const value = normalizePrograms ? "value-'program_id'" : 'value';
    const [result] = await q(`select
      (select coalesce(jsonb_agg(x order by x::text),'[]') from (select ${value} x from jsonb_array_elements($1::jsonb)) r) =
      (select coalesce(jsonb_agg(x order by x::text),'[]') from (select ${value} x from jsonb_array_elements($2::jsonb)) r) same`, [table.json, current.json]);
    if (!result.same) fail(`Restored records differ: ${table.name}`);
  }
  if (digest(protectedBefore) !== digest(await protectedHashes(q, before.organizationId))) fail('Protected accounts, configuration or another organization changed.');
}
