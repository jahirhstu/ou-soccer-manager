export function databaseUrl(value: string | undefined, ref: string) {
  if (!value) throw new Error('Missing worker database credentials.');
  const url = new URL(value);
  const direct = url.hostname === `db.${ref}.supabase.co`;
  const pooler = url.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(url.username).endsWith(`.${ref}`);
  if ((!direct && !pooler) || (url.port && url.port !== '5432')) throw new Error('Worker requires the pinned project and a direct/session-pooler connection.');
  return value;
}

export function assertReadOnlySourceRole(role: { rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolbypassrls: boolean; privileged: boolean }, writable: boolean) {
  if (role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.privileged || writable || !role.rolbypassrls) {
    throw new Error('Production requires a dedicated SELECT-only BYPASSRLS role without administrative memberships. Filtered snapshots are not allowed.');
  }
}
