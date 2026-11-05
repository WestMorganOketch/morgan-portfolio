BEGIN;

CREATE TABLE IF NOT EXISTS public.jr_career_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 120),
  kind text NOT NULL CHECK (kind IN ('master_resume', 'certificate', 'supporting_document', 'employment_record')),
  original_filename text NOT NULL CHECK (length(original_filename) BETWEEN 1 AND 255),
  content_type text NOT NULL CHECK (content_type IN ('application/pdf', 'image/png', 'image/jpeg')),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  storage_path text NOT NULL UNIQUE CHECK (storage_path ~ '^[0-9a-f-]{36}\.enc$'),
  encryption_iv bytea NOT NULL CHECK (octet_length(encryption_iv) = 12),
  encryption_tag bytea NOT NULL CHECK (octet_length(encryption_tag) = 16),
  plaintext_sha256 text NOT NULL CHECK (plaintext_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
ALTER TABLE public.jr_career_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.jr_career_documents FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS jr_career_documents_active_idx
  ON public.jr_career_documents (created_at DESC, id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS jr_career_documents_kind_idx
  ON public.jr_career_documents (kind, created_at DESC) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.jr_career_document_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.jr_career_documents(id) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (purpose IN ('application_email')),
  action text NOT NULL CHECK (action IN ('granted', 'revoked')),
  actor text NOT NULL CHECK (length(actor) BETWEEN 1 AND 254),
  acknowledgement text NOT NULL DEFAULT '' CHECK (length(acknowledgement) <= 400),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.jr_career_document_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.jr_career_document_consents FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS jr_career_document_consents_latest_idx
  ON public.jr_career_document_consents (document_id, purpose, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.jr_reject_career_document_consent_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Career document consent records are append-only';
END;
$$;
DROP TRIGGER IF EXISTS jr_career_document_consent_append_only ON public.jr_career_document_consents;
CREATE TRIGGER jr_career_document_consent_append_only
  BEFORE UPDATE OR DELETE ON public.jr_career_document_consents
  FOR EACH ROW EXECUTE FUNCTION public.jr_reject_career_document_consent_mutation();

COMMIT;
