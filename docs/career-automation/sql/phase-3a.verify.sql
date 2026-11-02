SELECT
  to_regclass('public.jr_assessments') IS NOT NULL AS assessments_table_exists,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'jr_settings'
      AND column_name = 'excluded_keywords'
  ) AS excluded_keywords_exists,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'jr_settings'
      AND column_name = 'excluded_companies'
  ) AS excluded_companies_exists;

SELECT
  table_name,
  relrowsecurity AS rls_on,
  has_table_privilege('anon', oid, 'SELECT') AS anon_can_select,
  has_table_privilege('anon', oid, 'INSERT') AS anon_can_insert,
  has_table_privilege('anon', oid, 'UPDATE') AS anon_can_update,
  has_table_privilege('anon', oid, 'DELETE') AS anon_can_delete,
  has_table_privilege('authenticated', oid, 'SELECT') AS authenticated_can_select,
  has_table_privilege('authenticated', oid, 'INSERT') AS authenticated_can_insert,
  has_table_privilege('authenticated', oid, 'UPDATE') AS authenticated_can_update,
  has_table_privilege('authenticated', oid, 'DELETE') AS authenticated_can_delete
FROM pg_class AS relation
JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = 'public'
  AND relation.relkind IN ('r', 'p')
  AND relation.relname LIKE 'jr\_%' ESCAPE '\'
ORDER BY table_name;
