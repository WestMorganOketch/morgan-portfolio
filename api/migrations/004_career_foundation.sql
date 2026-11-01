BEGIN;

CREATE TABLE IF NOT EXISTS public.jr_settings (
  id smallint PRIMARY KEY CHECK (id = 1),
  role_tracks text[] NOT NULL,
  countries text[] NOT NULL,
  remote_eligibility jsonb NOT NULL,
  score_threshold integer NOT NULL CHECK (score_threshold BETWEEN 0 AND 100),
  max_packets_per_day integer NOT NULL CHECK (max_packets_per_day BETWEEN 1 AND 5),
  max_sends_per_day integer NOT NULL CHECK (max_sends_per_day BETWEEN 1 AND 5),
  timezone text NOT NULL,
  show_company_name boolean NOT NULL DEFAULT false,
  public_publishing boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.jr_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.jr_settings FROM PUBLIC, anon, authenticated;

INSERT INTO public.jr_settings (
  id, role_tracks, countries, remote_eligibility, score_threshold,
  max_packets_per_day, max_sends_per_day, timezone, show_company_name, public_publishing
) VALUES (
  1,
  ARRAY['Security Analyst/SOC', 'Computer Skills/ICT Trainer'],
  ARRAY['Kenya', 'Tanzania', 'Uganda'],
  '{"Kenya": true}'::jsonb,
  65, 5, 5, 'Africa/Nairobi', false, false
) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.jr_resume_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  track text NOT NULL CHECK (length(track) BETWEEN 1 AND 80),
  original_text text NOT NULL CHECK (length(original_text) <= 60000),
  verified_facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
ALTER TABLE public.jr_resume_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.jr_resume_profiles FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.jr_preserve_resume_original()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.original_text IS DISTINCT FROM OLD.original_text THEN
    RAISE EXCEPTION 'Resume original_text is immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS jr_resume_original_immutable ON public.jr_resume_profiles;
CREATE TRIGGER jr_resume_original_immutable
  BEFORE UPDATE ON public.jr_resume_profiles
  FOR EACH ROW EXECUTE FUNCTION public.jr_preserve_resume_original();

CREATE TABLE IF NOT EXISTS public.jr_sources (
  key text PRIMARY KEY,
  name text NOT NULL,
  terms_url text,
  docs_url text,
  last_reviewed_at timestamptz,
  auth_type text NOT NULL,
  min_interval_seconds integer NOT NULL CHECK (min_interval_seconds >= 0),
  max_requests_per_day integer NOT NULL CHECK (max_requests_per_day > 0),
  attribution_text text NOT NULL,
  private_use_allowed boolean NOT NULL DEFAULT false,
  public_redisplay_allowed boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT false,
  notes text
);
ALTER TABLE public.jr_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.jr_sources FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.jr_source_state (
  source_key text PRIMARY KEY REFERENCES public.jr_sources(key) ON DELETE CASCADE,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_status text,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  requests_today integer NOT NULL DEFAULT 0 CHECK (requests_today >= 0),
  window_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Africa/Nairobi')::date,
  next_allowed_at timestamptz
);
ALTER TABLE public.jr_source_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.jr_source_state FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.jr_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger text NOT NULL CHECK (trigger IN ('cron', 'manual')),
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'interrupted', 'skipped')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.jr_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.jr_runs FROM PUBLIC, anon, authenticated;
CREATE UNIQUE INDEX IF NOT EXISTS jr_runs_single_running_idx
  ON public.jr_runs (status) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS jr_runs_started_at_idx ON public.jr_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS public.jr_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.jr_audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.jr_audit_events FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS jr_audit_events_at_idx ON public.jr_audit_events (at DESC);

CREATE OR REPLACE FUNCTION public.jr_reject_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Career audit events are append-only';
END;
$$;
DROP TRIGGER IF EXISTS jr_audit_events_append_only ON public.jr_audit_events;
CREATE TRIGGER jr_audit_events_append_only
  BEFORE UPDATE OR DELETE ON public.jr_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.jr_reject_audit_mutation();

INSERT INTO public.jr_sources (
  key, name, terms_url, docs_url, auth_type, min_interval_seconds,
  max_requests_per_day, attribution_text, private_use_allowed,
  public_redisplay_allowed, enabled, notes
) VALUES
  ('jobicy', 'Jobicy', NULL, 'https://jobicy.com/api/jobs', 'none', 3600, 24, 'Jobicy', true, true, true, NULL),
  ('remoteok', 'Remote OK', NULL, 'https://remoteok.com/api', 'none', 21600, 4, 'Remote OK', true, true, true, NULL),
  ('arbeitnow', 'Arbeitnow', NULL, 'https://www.arbeitnow.com/api/job-board-api', 'none', 21600, 4, 'Arbeitnow', true, true, true, NULL),
  ('remotive', 'Remotive', NULL, 'https://remotive.com/api/remote-jobs', 'none', 21600, 4, 'Remotive', true, false, true, NULL),
  ('ats_watchlist', 'Greenhouse/Lever watchlist', NULL, NULL, 'none', 21600, 4, 'Official employer job board', true, true, false, 'Enable only after adding verified public boards.'),
  ('reliefweb', 'ReliefWeb', NULL, 'https://api.reliefweb.int/v2/jobs', 'appname', 21600, 4, 'ReliefWeb and original source', false, false, false, 'Disabled until appname and use are approved.'),
  ('careerjet', 'Careerjet Kenya', NULL, NULL, 'api_key_and_user_context', 21600, 4, 'Careerjet and original source', false, false, false, 'Disabled until access and use are approved.'),
  ('myjobmag_ke_rss', 'MyJobMag Kenya RSS', NULL, 'https://www.myjobmag.co.ke/feeds/', 'none', 21600, 4, 'MyJobMag Kenya', false, false, false, 'Disabled until exact feed and private-use terms are verified.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.jr_source_state (source_key)
SELECT key FROM public.jr_sources
ON CONFLICT (source_key) DO NOTHING;

COMMIT;
