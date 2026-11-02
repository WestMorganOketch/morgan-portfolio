-- manual, never auto-run
BEGIN;
DROP TABLE IF EXISTS public.jr_application_events;
DROP TABLE IF EXISTS public.jr_applications;
DROP FUNCTION IF EXISTS public.jr_reject_application_event_mutation();
COMMIT;
