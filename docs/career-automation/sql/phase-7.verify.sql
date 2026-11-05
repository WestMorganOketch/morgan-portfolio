SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_can_select,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_can_select
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname = 'jr_public_snapshots'
ORDER BY c.relname;
