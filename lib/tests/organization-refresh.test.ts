import { beforeAll, afterAll, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { localDatabase } from '../../scripts/demo/local-database';
import { accounts, buildDemoDataset, demoId, type AccountIds } from '../../scripts/demo/dataset';
import { capture, compatible, digest, protectedHashes, replace, type Query } from '../../scripts/refresh/snapshot';
import { refreshEnabled, REFRESH_SOURCE, REFRESH_TARGET } from '../production-refresh';
import { assertReadOnlySourceRole, databaseUrl } from '../../scripts/refresh/config';

let db: Awaited<ReturnType<typeof localDatabase>>;
let q: Query;
const org = demoId('northstar-demo');
const ids = Object.fromEntries(accounts.map(key => [key, demoId(`account:${key}`)])) as AccountIds;
beforeAll(async () => {
  db = await localDatabase(); q = async (sql, values) => (await db.query(sql, values)).rows;
  for (const file of readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort()) await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  for (const key of accounts) await q('insert into auth.users(id,email) values($1,$2)', [ids[key], `${key}@test.invalid`]);
  await db.exec('begin');
  await db.exec(buildDemoDataset(ids, '2026-10-26').sql);
  await db.exec('commit');
}, 120000);
afterAll(async () => { await db?.close(); });

it('is disabled unless explicitly enabled on the pinned development deployment', () => {
  const env = { ENABLE_PRODUCTION_REFRESH: 'true', APP_ENVIRONMENT: 'development', NEXT_PUBLIC_SUPABASE_URL: `https://${REFRESH_TARGET}.supabase.co` };
  expect(refreshEnabled(env)).toBe(true);
  expect(refreshEnabled({ ...env, APP_ENVIRONMENT: 'production' })).toBe(false);
  expect(refreshEnabled({ ...env, NEXT_PUBLIC_SUPABASE_URL: 'https://production.supabase.co' })).toBe(false);
  expect(refreshEnabled({})).toBe(false);
});

it('rejects reversed databases, arbitrary hosts and transaction poolers', () => {
  const source = `postgresql://reader:placeholder@db.${REFRESH_SOURCE}.supabase.co:5432/postgres`;
  expect(databaseUrl(source,REFRESH_SOURCE)).toBe(source);
  expect(() => databaseUrl(source,REFRESH_TARGET)).toThrow('pinned project');
  expect(() => databaseUrl(`postgresql://reader.${REFRESH_TARGET}:placeholder@evil.example:5432/postgres`,REFRESH_TARGET)).toThrow();
  expect(() => databaseUrl(source.replace(':5432',':6543'),REFRESH_SOURCE)).toThrow();
});

it('rejects writable, administrative and RLS-filtered production credentials', () => {
  const role = { rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolbypassrls:true,privileged:false };
  expect(() => assertReadOnlySourceRole(role,false)).not.toThrow();
  expect(() => assertReadOnlySourceRole(role,true)).toThrow();
  expect(() => assertReadOnlySourceRole({...role,rolsuper:true},false)).toThrow();
  expect(() => assertReadOnlySourceRole({...role,privileged:true},false)).toThrow();
  expect(() => assertReadOnlySourceRole({...role,rolbypassrls:false},false)).toThrow('Filtered snapshots');
});

it('replaces one organization, preserves accounts and other organizations, and is repeatable', async () => {
  const source = await capture(q, org);
  const protectedBefore = await protectedHashes(q, org);
  await db.exec('begin');
  try {
    await q("update payments set amount=amount+0.01 where organization_id=$1 and program_id in (select id from programs where slug='soccer')", [org]);
    await q("insert into players(id,organization_id,display_name) values($1,$2,'Development-only guest')", [demoId('development-only-guest'),org]);
    const target = await capture(q, org);
    expect(digest(target)).not.toBe(digest(source));
    await replace(q, source, target);
    expect(digest(await capture(q, org))).toBe(digest(source));
    expect(await protectedHashes(q, org)).toEqual(protectedBefore);
    await replace(q, source, await capture(q, org));
    expect(digest(await capture(q, org))).toBe(digest(source));
    await replace(q, target, await capture(q, org), false);
    expect(digest(await capture(q, org))).toBe(digest(target));
  } finally { await db.exec('rollback'); }
}, 120000);

it('blocks missing account dependencies and rolls back the entire replacement', async () => {
  const before = await capture(q, org);
  const broken = structuredClone(before);
  const payment = broken.tables.find(t => t.name === 'payments')!;
  const rows = JSON.parse(payment.json); rows[0].created_by = '99999999-0000-4000-8000-000000000001'; payment.json = JSON.stringify(rows);
  await db.exec('begin');
  try { await expect(replace(q, broken, before)).rejects.toThrow('Missing dependency'); }
  finally { await db.exec('rollback'); }
  expect(digest(await capture(q, org))).toBe(digest(before));
}, 120000);

it('backfills legacy season signup scope even when payment session_id is null', async () => {
  const original = await capture(q, org);
  let legacy = original;
  await db.exec('begin; set local session_replication_role=replica');
  try {
    await q('update payments set program_id=null where organization_id=$1 and session_id is null', [org]);
    legacy = await capture(q, org);
  } finally { await db.exec('rollback'); }
  await db.exec('begin');
  try {
    await replace(q, legacy, original);
    expect(digest(await capture(q, org))).toBe(digest(original));
  } finally { await db.exec('rollback'); }
}, 120000);

it('rejects another organization and incompatible column types', async () => {
  const source = await capture(q, org);
  expect(() => compatible(source, { ...source, organizationId: demoId('riverside-demo') })).toThrow('mapping');
  const changed = structuredClone(source); changed.tables[0].columns[0].type = 'integer';
  expect(() => compatible(source, changed)).toThrow('Schema mismatch');
});

it('requires organization admin membership, opt-in, a preview, and one active job', async () => {
  await db.exec('begin');
  try {
    await q("select set_config('request.jwt.claim.sub',$1,true)", [ids.owner]);
    await expect(q('select request_development_refresh($1)', [org])).rejects.toThrow('not configured');
  } finally { await db.exec('rollback'); }
  await db.exec('begin');
  try {
    await q("insert into development_refresh_targets values($1,true,'uqntqbcimkyoiptvtrem','vnmloamscqaqmagimfmz')", [org]);
    for (const actor of [ids.member, ids['soccer-manager'], ids['platform-owner'], ids['other-owner']]) {
      await db.exec('savepoint denied');
      await q("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
      await expect(q('select request_development_refresh($1)', [org])).rejects.toThrow('organization owner or admin');
      await db.exec('rollback to savepoint denied');
    }
    await q("select set_config('request.jwt.claim.sub',$1,true)", [ids.owner]);
    const [{ id }] = await q('select request_development_refresh($1) id', [org]);
    await db.exec('savepoint duplicate');
    await expect(q('select request_development_refresh($1)', [org])).rejects.toThrow('duplicate key');
    await db.exec('rollback to savepoint duplicate');
    await db.exec('savepoint premature');
    await expect(q("select request_development_refresh($1,$2,'confirm')", [org,id])).rejects.toThrow('Analyze again');
    await db.exec('rollback to savepoint premature');
    await q("update development_refresh_jobs set status='preview_ready',expires_at=now()+interval '30 minutes' where id=$1", [id]);
    await q("select request_development_refresh($1,$2,'confirm')", [org,id]);
    expect((await q('select status from development_refresh_jobs where id=$1',[id]))[0].status).toBe('apply_queued');
    await q("select request_development_refresh($1,$2,'cancel')", [org,id]);
    expect((await q('select status from development_refresh_jobs where id=$1',[id]))[0].status).toBe('cancelled');
    const [{ id: expired }] = await q('select request_development_refresh($1) id', [org]);
    await q("update development_refresh_jobs set status='preview_ready',expires_at=now()-interval '1 minute' where id=$1", [expired]);
    await db.exec('savepoint expired');
    await expect(q("select request_development_refresh($1,$2,'confirm')", [org,expired])).rejects.toThrow('Analyze again');
    await db.exec('rollback to savepoint expired');
    await db.exec('set local role authenticated');
    expect((await q('select id from development_refresh_jobs')).length).toBe(2);
    await q("select set_config('request.jwt.claim.sub',$1,true)", [ids.member]);
    expect((await q('select id from development_refresh_jobs')).length).toBe(0);
  } finally { await db.exec('rollback'); }
}, 120000);
