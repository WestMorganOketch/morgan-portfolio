-- manual, never auto-run
BEGIN;
DROP TABLE IF EXISTS public.jr_audit_events;
DROP TABLE IF EXISTS public.jr_runs;
DROP TABLE IF EXISTS public.jr_source_state;
DROP TABLE IF EXISTS public.jr_sources;
DROP TABLE IF EXISTS public.jr_resume_profiles;
DROP TABLE IF EXISTS public.jr_settings;
COMMIT;
