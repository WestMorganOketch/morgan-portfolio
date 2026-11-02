-- manual, never auto-run
BEGIN;
DROP TABLE IF EXISTS public.jr_assessments;
DO $phase3a_rollback_status$
DECLARE
  status_constraint_name text;
  status_constraint_definition text;
  original_statuses text := '''discovered'', ''shortlisted'', ''maybe'', ''flagged'', ''passed'', ''duplicate'', ''expired'', ''closed''';
BEGIN
  SELECT conname, pg_get_constraintdef(oid)
    INTO status_constraint_name, status_constraint_definition
    FROM pg_constraint
   WHERE conrelid = 'public.jr_jobs'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ~* '\mstatus\M'
   ORDER BY conname
   LIMIT 1;

  IF NOT FOUND THEN
    EXECUTE format(
      'ALTER TABLE public.jr_jobs ADD CONSTRAINT jr_jobs_status_check CHECK (status IN (%s))',
      original_statuses
    );
  ELSIF position('screened' IN lower(status_constraint_definition)) > 0 THEN
    EXECUTE format('ALTER TABLE public.jr_jobs DROP CONSTRAINT %I', status_constraint_name);
    EXECUTE format(
      'ALTER TABLE public.jr_jobs ADD CONSTRAINT %I CHECK (status IN (%s))',
      status_constraint_name,
      original_statuses
    );
  END IF;
END
$phase3a_rollback_status$;
COMMIT;
