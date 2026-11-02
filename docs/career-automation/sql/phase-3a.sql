BEGIN;

ALTER TABLE public.jr_settings
  ADD COLUMN IF NOT EXISTS excluded_keywords text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS excluded_companies text[] NOT NULL DEFAULT '{}';

DO $phase3a_status$
DECLARE
  status_constraint_name text;
  status_constraint_definition text;
  allowed_statuses text := '''discovered'', ''screened'', ''match_review'', ''shortlisted'', ''blocked_risk'', ''not_a_fit'', ''duplicate'', ''expired'', ''needs_manual_attention'', ''maybe'', ''flagged'', ''passed'', ''closed''';
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
      allowed_statuses
    );
  ELSIF position('screened' IN lower(status_constraint_definition)) = 0 THEN
    EXECUTE format('ALTER TABLE public.jr_jobs DROP CONSTRAINT %I', status_constraint_name);
    EXECUTE format(
      'ALTER TABLE public.jr_jobs ADD CONSTRAINT %I CHECK (status IN (%s))',
      status_constraint_name,
      allowed_statuses
    );
  END IF;
END
$phase3a_status$;

CREATE TABLE IF NOT EXISTS public.jr_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jr_jobs(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES public.jr_resume_profiles(id) ON DELETE CASCADE,
  track text,
  eligibility text NOT NULL CHECK (eligibility IN ('eligible', 'unknown', 'ineligible')),
  eligibility_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  fit_score integer NOT NULL CHECK (fit_score BETWEEN 0 AND 100),
  fit_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  matched jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason_codes text[] NOT NULL DEFAULT '{}',
  uncertainty jsonb NOT NULL DEFAULT '[]'::jsonb,
  rules_version integer NOT NULL CHECK (rules_version > 0),
  assessed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, profile_id)
);
ALTER TABLE public.jr_assessments ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.jr_assessments FROM PUBLIC, anon, authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS jr_assessments_job_without_profile_idx
  ON public.jr_assessments (job_id) WHERE profile_id IS NULL;
CREATE INDEX IF NOT EXISTS jr_assessments_score_idx
  ON public.jr_assessments (fit_score DESC, assessed_at DESC);
CREATE INDEX IF NOT EXISTS jr_assessments_eligibility_idx
  ON public.jr_assessments (eligibility, assessed_at DESC);

COMMIT;
