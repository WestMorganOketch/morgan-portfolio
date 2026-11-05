BEGIN;

CREATE TABLE IF NOT EXISTS public.jr_public_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  snapshot_json jsonb NOT NULL CHECK (jsonb_typeof(snapshot_json) = 'object'),
  snapshot_sha256 text NOT NULL CHECK (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  job_count integer NOT NULL CHECK (job_count BETWEEN 1 AND 100),
  published_by text NOT NULL CHECK (length(published_by) BETWEEN 1 AND 254),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (snapshot_json->>'schema_version' = '1'),
  CHECK (jsonb_typeof(snapshot_json->'jobs') = 'array'),
  CHECK (jsonb_array_length(snapshot_json->'jobs') = job_count)
);
ALTER TABLE public.jr_public_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.jr_public_snapshots FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS jr_public_snapshots_latest_idx
  ON public.jr_public_snapshots (created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.jr_reject_public_snapshot_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Published Career Radar snapshots are immutable; publish a new version instead';
END;
$$;
DROP TRIGGER IF EXISTS jr_public_snapshots_immutable ON public.jr_public_snapshots;
CREATE TRIGGER jr_public_snapshots_immutable
  BEFORE UPDATE OR DELETE ON public.jr_public_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.jr_reject_public_snapshot_mutation();

COMMIT;
