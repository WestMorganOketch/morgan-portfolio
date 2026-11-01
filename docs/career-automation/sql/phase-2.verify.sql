SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('jr_jobs', 'jr_ats_watchlist')
  AND c.relkind = 'r'
ORDER BY c.relname;

SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('jr_jobs', 'jr_ats_watchlist')
  AND grantee IN ('PUBLIC', 'anon', 'authenticated')
ORDER BY table_name, grantee, privilege_type;

SELECT key, enabled, private_use_allowed, public_redisplay_allowed
FROM public.jr_sources
WHERE key = 'manual_import';

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('jr_jobs', 'jr_ats_watchlist')
ORDER BY tablename, indexname;
