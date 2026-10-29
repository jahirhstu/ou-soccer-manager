import { readFileSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, chmodSync, existsSync, realpathSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import postgres from 'postgres';
import { REFRESH_SOURCE, REFRESH_TARGET, refreshEnabled } from '../../lib/production-refresh';
import { capture, compatible, digest, ident, replace, type Query, type Snapshot } from './snapshot';
import { assertReadOnlySourceRole, databaseUrl } from './config';

function persist(path: string, data: unknown) {
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(data)); fsyncSync(fd); } finally { closeSync(fd); }
}
const stableData = (s: Snapshot) => digest({ ...s, tables: s.tables.filter(t => t.name !== 'audit_logs') });

async function main() {
  if (!refreshEnabled() || process.env.REFRESH_WRITERS_STOPPED !== 'true') {
    throw new Error('Worker requires the development environment and confirmed stopped writers/outbound integrations.');
  }
  const sourceUrl = databaseUrl(process.env.REFRESH_PRODUCTION_DATABASE_URL, REFRESH_SOURCE);
  const targetUrl = databaseUrl(process.env.REFRESH_DEVELOPMENT_DATABASE_URL, REFRESH_TARGET);
  if (sourceUrl === targetUrl) throw new Error('Source and destination must differ.');
  const recoveryId = process.argv.find(arg => arg.startsWith('--recover='))?.slice('--recover='.length);
  if (recoveryId && (!/^[0-9a-f-]{36}$/.test(recoveryId) || !process.argv.includes(`--confirm-recovery=${REFRESH_TARGET}`))) {
    throw new Error('Recovery requires a job UUID and explicit development project confirmation.');
  }
  if (!process.env.REFRESH_BACKUP_DIRECTORY) throw new Error('A private persistent backup directory is required.');
  const root = resolve(process.env.REFRESH_BACKUP_DIRECTORY);
  if ([resolve('.'), resolve('/'), homedir(), tmpdir()].includes(root) || root.startsWith(resolve('.') + '/')) throw new Error('Use a dedicated backup directory outside the code repository.');
  const existed = existsSync(root);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (!existed) chmodSync(root, 0o700);
  if (realpathSync(root) === realpathSync('.') || realpathSync(root).startsWith(realpathSync('.') + '/') || (statSync(root).mode & 0o077)) {
    throw new Error('Backup directory must be private (0700) and outside the repository.');
  }
  const source = postgres(sourceUrl, { ssl: 'require', max: 1, prepare: false, connect_timeout: 20,
    onnotice: () => {}, connection: { default_transaction_read_only: true, row_security: 'off', statement_timeout: 60000 } });
  const target = postgres(targetUrl, { ssl: 'require', max: 1, prepare: false, connect_timeout: 20, onnotice: () => {}, connection: { row_security: 'off' } });
  let locked = false;
  let job: any;
  try {
    const [role] = await source`select rolsuper,rolcreatedb,rolcreaterole,rolbypassrls,current_user as name,
      pg_has_role(current_user,'postgres','member') privileged from pg_roles where rolname=current_user`;
    const writable = await source`select 1 from pg_tables where schemaname='public'
      and (has_table_privilege(current_user,quote_ident(schemaname)||'.'||quote_ident(tablename),'INSERT,UPDATE,DELETE,TRUNCATE')
        or has_any_column_privilege(current_user,quote_ident(schemaname)||'.'||quote_ident(tablename),'INSERT,UPDATE')) limit 1`;
    assertReadOnlySourceRole(role as Parameters<typeof assertReadOnlySourceRole>[0], writable.length > 0);
    locked = (await target`select pg_try_advisory_lock(920026) locked`)[0].locked;
    if (!locked) { console.log('Another refresh worker is active.'); return; }
    if (recoveryId) {
      const [record] = await target`select * from public.development_refresh_jobs where id=${recoveryId}`;
      if (!record) throw new Error('Recovery job not found.');
      const saved = JSON.parse(readFileSync(join(root, recoveryId, 'recovery.json'), 'utf8')) as { snapshot: Snapshot; hash: string };
      if (saved.snapshot.organizationId !== record.organization_id || digest(saved.snapshot) !== saved.hash) throw new Error('Recovery backup integrity check failed.');
      await target.begin(async tx => {
        const q: Query = (sql, values) => tx.unsafe(sql, values);
        await q("set local lock_timeout='10s'; set local statement_timeout='120s'");
        const tables = await q("select tablename from pg_tables where schemaname='public' order by tablename");
        await q(`lock table ${tables.map(r => 'public.' + ident(r.tablename)).join(',')} in share row exclusive mode`);
        const current = await capture(q, record.organization_id);
        persist(join(root, recoveryId, `before-recovery-${Date.now()}.json`), { snapshot: current, hash: digest(current) });
        await replace(q, saved.snapshot, current, false);
        await tx`insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,new_data)
          values(${record.organization_id},${record.requested_by},'development_refresh_recovered','development_refresh_jobs',${record.id},
            ${tx.json({ operator: true, direction: 'local_backup_to_development' })})`;
      });
      console.log('Organization backup recovered; current data was backed up first.');
      return;
    }
    // An interrupted apply transaction rolls back. Never retry destructive work silently.
    await target`update public.development_refresh_jobs set status='failed',error='Worker interrupted. Analyze again; check the private recovery backup.',updated_at=now()
      where status in ('analyzing','applying')`;
    job = await target.begin(async tx => {
      const [next] = await tx`select * from public.development_refresh_jobs where status in ('analyze_queued','apply_queued') order by created_at for update skip locked limit 1`;
      if (!next) return null;
      const authorized = await tx`select 1 from public.organization_members m join public.development_refresh_targets c using(organization_id)
        where m.organization_id=${next.organization_id} and m.profile_id=${next.requested_by} and m.status='active'
        and m.role in ('owner','admin') and c.enabled and c.source_ref=${REFRESH_SOURCE} and c.target_ref=${REFRESH_TARGET}`;
      if (!authorized.length) {
        await tx`update public.development_refresh_jobs set status='failed',error='Organization authorization is no longer valid.',updated_at=now() where id=${next.id}`;
        return null;
      }
      await tx`update public.development_refresh_jobs set status=${next.status === 'analyze_queued' ? 'analyzing' : 'applying'},updated_at=now() where id=${next.id}`;
      return next;
    });
    if (!job) { console.log('No queued refresh.'); return; }
    const folder = join(root, job.id);
    if (job.status === 'analyze_queued') {
      const incoming = await source.begin('isolation level repeatable read read only', tx => capture((q,p) => tx.unsafe(q,p), job.organization_id));
      const existing = await target.begin('isolation level repeatable read read only', tx => capture((q,p) => tx.unsafe(q,p), job.organization_id));
      compatible(incoming, existing);
      const packet = { incoming, existing, capturedAt: new Date().toISOString() };
      if (Buffer.byteLength(JSON.stringify(packet)) > 50_000_000) throw new Error('Snapshot exceeds the reviewed 50 MB limit.');
      mkdirSync(folder, { mode: 0o700 });
      persist(join(folder, 'preview.json'), packet);
      const preview = incoming.tables.map(t => ({ table: t.name, production: t.count, development: existing.tables.find(x => x.name === t.name)!.count }));
      await target`update public.development_refresh_jobs set status='preview_ready',preview=${target.json(preview)},snapshot_hash=${digest(packet)},
        expires_at=now()+interval '30 minutes',updated_at=now() where id=${job.id}`;
      console.log('Preview ready; explicit confirmation is required.');
    } else {
      if (!job.expires_at || new Date(job.expires_at).getTime() <= Date.now()) throw new Error('Preview expired. Analyze again.');
      const packet = JSON.parse(readFileSync(join(folder, 'preview.json'), 'utf8')) as { incoming: Snapshot; existing: Snapshot };
      if (digest(packet) !== job.snapshot_hash || packet.incoming.organizationId !== job.organization_id) throw new Error('Snapshot integrity check failed.');
      await target.begin(async tx => {
        const q: Query = (sql, values) => tx.unsafe(sql, values);
        await q("set local lock_timeout='10s'; set local statement_timeout='120s'");
        const tables = await q("select tablename from pg_tables where schemaname='public' order by tablename");
        await q(`lock table ${tables.map(r => 'public.' + ident(r.tablename)).join(',')} in share row exclusive mode`);
        const valid = await q(`select 1 from public.organization_members m join public.development_refresh_targets c using(organization_id)
          where m.organization_id=$1 and m.profile_id=$2 and m.status='active' and m.role in ('owner','admin') and c.enabled`, [job.organization_id, job.requested_by]);
        if (!valid.length) throw new Error('Organization authorization changed.');
        const current = await capture(q, job.organization_id);
        if (stableData(current) !== stableData(packet.existing)) throw new Error('Development data changed after preview. Analyze again.');
        persist(join(folder, 'recovery.json'), { snapshot: current, hash: digest(current) });
        await replace(q, packet.incoming, current);
        await tx`update public.development_refresh_jobs set status='succeeded',error=null,updated_at=now() where id=${job.id}`;
        await tx`insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,new_data)
          values(${job.organization_id},${job.requested_by},'development_refresh_completed','development_refresh_jobs',${job.id},
            ${tx.json({ direction: 'production_to_development', snapshot: job.snapshot_hash })})`;
      });
      console.log('Organization refresh committed; accounts, configuration and other organizations verified unchanged.');
    }
  } catch (error) {
    // Database errors can contain row data and credentials. Never expose raw details in jobs or logs.
    const message = error instanceof Error && !('code' in error) ? error.message : 'Database validation failed; all replacement writes rolled back. Operator review required.';
    if (job) await target`update public.development_refresh_jobs set status='failed',error=${message},updated_at=now() where id=${job.id} and status<>'succeeded'`;
    console.error(message); process.exitCode = 1;
  } finally {
    if (locked) await target`select pg_advisory_unlock(920026)`;
    await source.end({ timeout: 2 }); await target.end({ timeout: 2 });
  }
}
main().catch(() => { console.error('Worker configuration or connection failed. No credentials printed.'); process.exitCode = 1; });
