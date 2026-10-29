export const schemaQueries = {
  functionPrivileges: `select p.proname as name,pg_get_function_identity_arguments(p.oid) as arguments,has_function_privilege('anon',p.oid,'execute') as anon,has_function_privilege('authenticated',p.oid,'execute') as authenticated,has_function_privilege('service_role',p.oid,'execute') as service_role from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') order by 1,2`,
  columns: `select c.relname as table_name,a.attname as column_name,format_type(a.atttypid,a.atttypmod) as type,a.attnotnull as not_null,pg_get_expr(d.adbin,d.adrelid) as default_value from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where n.nspname='public' and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped order by 1,2`,
  tables: `select c.relname as name,c.relrowsecurity as rls,c.relforcerowsecurity as force_rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') order by 1`,
  constraints: `select c.relname as table_name,k.conname as name,pg_get_constraintdef(k.oid) as definition from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by 1,2`,
  indexes: `select tablename as table_name,indexname as name,indexdef as definition from pg_indexes where schemaname='public' order by 1,2`,
  views: `select c.relname as name,pg_get_viewdef(c.oid,true) as definition from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m') order by 1`,
  functions: `select p.proname as name,pg_get_function_identity_arguments(p.oid) as arguments,pg_get_functiondef(p.oid) as definition,p.proacl::text as acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') order by 1,2`,
  policies: `select tablename as table_name,policyname as name,permissive,roles::text,cmd,qual,with_check from pg_policies where schemaname='public' order by 1,2`,
  triggers: `select n.nspname as schema_name,c.relname as table_name,t.tgname as name,pg_get_triggerdef(t.oid) as definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and (n.nspname='public' or (n.nspname='auth' and c.relname='users')) order by 1,2,3`,
};
export const attributionLinks = [
  ["player_aliases","created_by"], ["session_player_charges","created_by"],
  ["session_team_players","created_by"], ["session_team_update_events","updated_by"],
  ["session_teams","created_by"]
] as const;
