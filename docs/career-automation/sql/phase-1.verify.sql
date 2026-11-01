SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname LIKE 'jr\_%' ESCAPE '\'
  AND c.relkind = 'r'
ORDER BY c.relname;

SELECT
  table_name,
  grantee,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name LIKE 'jr\_%' ESCAPE '\'
  AND grantee IN ('PUBLIC', 'anon', 'authenticated')
ORDER BY table_name, grantee, privilege_type;

SELECT id, role_tracks, countries, remote_eligibility, score_threshold,
       max_packets_per_day, max_sends_per_day, timezone, show_company_name,
       public_publishing, updated_at
FROM public.jr_settings
WHERE id = 1;

SELECT key, enabled, private_use_allowed, public_redisplay_allowed,
       min_interval_seconds, max_requests_per_day
FROM public.jr_sources
ORDER BY key;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'jr_runs'
ORDER BY indexname;
