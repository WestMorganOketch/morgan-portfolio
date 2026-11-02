BEGIN;

ALTER TABLE public.jr_assessments
  ADD COLUMN IF NOT EXISTS risk_level text,
  ADD COLUMN IF NOT EXISTS risk_findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS risk_confidence integer,
  ADD COLUMN IF NOT EXISTS unknowns jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS url_checks jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS risk_assessed_at timestamptz;

DO $phase3b_risk_level$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.jr_assessments'::regclass
      AND conname = 'jr_assessments_risk_level_check'
  ) THEN
    ALTER TABLE public.jr_assessments
      ADD CONSTRAINT jr_assessments_risk_level_check
      CHECK (risk_level IS NULL OR risk_level IN (
        'lower_risk', 'needs_manual_verification', 'high_risk', 'blocked_by_rule'
      ));
  END IF;
END
$phase3b_risk_level$;

DO $phase3b_risk_confidence$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.jr_assessments'::regclass
      AND conname = 'jr_assessments_risk_confidence_check'
  ) THEN
    ALTER TABLE public.jr_assessments
      ADD CONSTRAINT jr_assessments_risk_confidence_check
      CHECK (risk_confidence IS NULL OR risk_confidence BETWEEN 0 AND 100);
  END IF;
END
$phase3b_risk_confidence$;

CREATE TABLE IF NOT EXISTS public.jr_domain_cache (
  domain text PRIMARY KEY,
  checked_at timestamptz NOT NULL,
  rdap_age_days integer CHECK (rdap_age_days IS NULL OR rdap_age_days >= 0),
  dns_ok boolean NOT NULL,
  https_ok boolean NOT NULL,
  ats_provider text CHECK (ats_provider IS NULL OR ats_provider IN (
    'greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters'
  )),
  expires_at timestamptz NOT NULL,
  CHECK (domain = lower(domain))
);
ALTER TABLE public.jr_domain_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.jr_domain_cache FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS jr_domain_cache_expiry_idx
  ON public.jr_domain_cache (expires_at);
CREATE INDEX IF NOT EXISTS jr_assessments_risk_idx
  ON public.jr_assessments (risk_level, risk_assessed_at DESC);

COMMIT;
