SELECT
  to_regclass('public.jr_applications') IS NOT NULL AS applications_table_exists,
  to_regclass('public.jr_application_events') IS NOT NULL AS application_events_table_exists;

SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_on,
  has_table_privilege('anon', c.oid, 'SELECT') AS anon_can_select,
  has_table_privilege('anon', c.oid, 'INSERT') AS anon_can_insert,
  has_table_privilege('anon', c.oid, 'UPDATE') AS anon_can_update,
  has_table_privilege('anon', c.oid, 'DELETE') AS anon_can_delete,
  has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_can_select,
  has_table_privilege('authenticated', c.oid, 'INSERT') AS authenticated_can_insert,
  has_table_privilege('authenticated', c.oid, 'UPDATE') AS authenticated_can_update,
  has_table_privilege('authenticated', c.oid, 'DELETE') AS authenticated_can_delete
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND c.relname LIKE 'jr\_%' ESCAPE '\'
ORDER BY c.relname;
