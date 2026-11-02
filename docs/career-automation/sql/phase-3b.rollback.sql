-- manual, never auto-run
BEGIN;
DROP TABLE IF EXISTS public.jr_domain_cache;
DROP INDEX IF EXISTS public.jr_assessments_risk_idx;
ALTER TABLE public.jr_assessments
  DROP CONSTRAINT IF EXISTS jr_assessments_risk_level_check,
  DROP CONSTRAINT IF EXISTS jr_assessments_risk_confidence_check,
  DROP COLUMN IF EXISTS risk_level,
  DROP COLUMN IF EXISTS risk_findings,
  DROP COLUMN IF EXISTS risk_confidence,
  DROP COLUMN IF EXISTS unknowns,
  DROP COLUMN IF EXISTS url_checks,
  DROP COLUMN IF EXISTS risk_assessed_at;
COMMIT;
