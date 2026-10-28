CREATE TABLE IF NOT EXISTS contact_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  subject text NOT NULL,
  message text NOT NULL,
  consent_given_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days')
);

CREATE INDEX IF NOT EXISTS contact_messages_expiry_idx
  ON contact_messages (expires_at);

CREATE TABLE IF NOT EXISTS soc_alerts (
  id text PRIMARY KEY,
  title text NOT NULL,
  source text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('Low', 'Medium', 'High', 'Critical')),
  difficulty text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  details text NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('true_positive', 'false_positive')),
  explanation text NOT NULL,
  mitre text
);

CREATE TABLE IF NOT EXISTS triage_rounds (
  token_hash char(64) PRIMARY KEY,
  alert_ids text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  submitted_at timestamptz
);

CREATE INDEX IF NOT EXISTS triage_rounds_expiry_idx
  ON triage_rounds (expires_at);

CREATE TABLE IF NOT EXISTS triage_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname varchar(20) NOT NULL,
  score integer NOT NULL CHECK (score BETWEEN 0 AND 1500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS triage_scores_leaderboard_idx
  ON triage_scores (score DESC, created_at ASC);

CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  category text NOT NULL CHECK (category IN ('Resume', 'Certificates', 'Lab Reports')),
  description text NOT NULL DEFAULT '',
  issued_date date,
  verify_url text,
  file_path text,
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category, title)
);

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS is_published boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS documents_public_order_idx
  ON documents (category, is_published, issued_date DESC, created_at DESC);
