BEGIN;

CREATE TABLE IF NOT EXISTS public.jr_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL REFERENCES public.jr_sources(key),
  source_job_id text NOT NULL,
  url text,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  company text,
  location_text text NOT NULL DEFAULT '',
  remote_scope_text text NOT NULL DEFAULT '',
  description_text text NOT NULL DEFAULT '' CHECK (length(description_text) <= 6000),
  salary_text text,
  tags text[] NOT NULL DEFAULT '{}',
  posted_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  canonical_key text NOT NULL UNIQUE,
  also_listed_on text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'discovered'
    CHECK (status IN ('discovered', 'shortlisted', 'maybe', 'flagged', 'passed', 'duplicate', 'expired', 'closed'))
);
ALTER TABLE public.jr_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.jr_jobs FROM PUBLIC, anon, authenticated;
CREATE UNIQUE INDEX IF NOT EXISTS jr_jobs_source_identity_idx
  ON public.jr_jobs (source_key, source_job_id);
CREATE INDEX IF NOT EXISTS jr_jobs_canonical_key_idx
  ON public.jr_jobs (canonical_key);
CREATE INDEX IF NOT EXISTS jr_jobs_status_idx ON public.jr_jobs (status);
CREATE INDEX IF NOT EXISTS jr_jobs_last_seen_at_idx ON public.jr_jobs (last_seen_at DESC);

CREATE TABLE IF NOT EXISTS public.jr_ats_watchlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('greenhouse', 'lever')),
  token text NOT NULL CHECK (token ~ '^[A-Za-z0-9_-]{2,60}$'),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, token)
);
ALTER TABLE public.jr_ats_watchlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.jr_ats_watchlist FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS jr_ats_watchlist_enabled_idx
  ON public.jr_ats_watchlist (enabled, provider);

-- Example only: replace placeholders with an employer's public board token and label.
-- INSERT INTO public.jr_ats_watchlist (provider, token, label) VALUES ('greenhouse', 'EXAMPLE_TOKEN', 'Example employer') ON CONFLICT (provider, token) DO NOTHING;
-- INSERT INTO public.jr_ats_watchlist (provider, token, label) VALUES ('lever', 'EXAMPLE_TOKEN', 'Example employer') ON CONFLICT (provider, token) DO NOTHING;

INSERT INTO public.jr_sources (
  key, name, auth_type, min_interval_seconds, max_requests_per_day,
  attribution_text, private_use_allowed, public_redisplay_allowed, enabled, notes
) VALUES (
  'manual_import', 'Manual advert import', 'none', 0, 1000000,
  'Manually imported by admin', true, false, true,
  'Admin-provided URL or advert text; the URL is stored and never fetched.'
) ON CONFLICT (key) DO NOTHING;

INSERT INTO public.jr_source_state (source_key)
SELECT key FROM public.jr_sources WHERE key = 'manual_import'
ON CONFLICT (source_key) DO NOTHING;

COMMIT;
