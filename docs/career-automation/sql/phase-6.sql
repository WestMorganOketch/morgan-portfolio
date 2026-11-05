BEGIN;

CREATE TABLE IF NOT EXISTS public.jr_application_packets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.jr_applications(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jr_jobs(id) ON DELETE CASCADE,
  source_profile_id uuid NOT NULL REFERENCES public.jr_resume_profiles(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'ready_for_review', 'approved_to_send', 'sending',
    'sent', 'failed_send', 'needs_manual_attention'
  )),
  resume_text text NOT NULL CHECK (length(resume_text) BETWEEN 1 AND 65000),
  cover_letter_text text NOT NULL CHECK (length(cover_letter_text) BETWEEN 1 AND 12000),
  recipient_email text CHECK (recipient_email IS NULL OR length(recipient_email) <= 254),
  highlights jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  master_resume_sha256 text NOT NULL CHECK (length(master_resume_sha256) = 64),
  gmail_message_id text,
  send_attempted_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, version)
);
ALTER TABLE public.jr_application_packets ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.jr_application_packets FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS jr_application_packets_latest_idx
  ON public.jr_application_packets (application_id, version DESC);
CREATE INDEX IF NOT EXISTS jr_application_packets_status_updated_idx
  ON public.jr_application_packets (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.jr_gmail_oauth_states (
  state_hash text PRIMARY KEY CHECK (length(state_hash) = 64),
  code_verifier text NOT NULL CHECK (length(code_verifier) BETWEEN 43 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
ALTER TABLE public.jr_gmail_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.jr_gmail_oauth_states FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS jr_gmail_oauth_states_expires_idx
  ON public.jr_gmail_oauth_states (expires_at);

CREATE TABLE IF NOT EXISTS public.jr_gmail_credentials (
  id smallint PRIMARY KEY CHECK (id = 1),
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  encrypted_refresh_token bytea NOT NULL,
  encryption_iv bytea NOT NULL CHECK (octet_length(encryption_iv) = 12),
  encryption_tag bytea NOT NULL CHECK (octet_length(encryption_tag) = 16),
  granted_scopes text[] NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.jr_gmail_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.jr_gmail_credentials FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.jr_reject_gmail_oauth_state_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Gmail OAuth state records are managed by the private API';
END;
$$;
DROP TRIGGER IF EXISTS jr_gmail_oauth_state_append_only ON public.jr_gmail_oauth_states;
CREATE TRIGGER jr_gmail_oauth_state_append_only
  BEFORE UPDATE ON public.jr_gmail_oauth_states
  FOR EACH ROW EXECUTE FUNCTION public.jr_reject_gmail_oauth_state_mutation();

COMMIT;
