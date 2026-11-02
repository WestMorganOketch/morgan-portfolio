BEGIN;

CREATE TABLE IF NOT EXISTS public.jr_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL UNIQUE REFERENCES public.jr_jobs(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'discovered' CHECK (state IN (
    'discovered', 'screened', 'match_review', 'shortlisted',
    'preparation_in_progress', 'ready_for_review', 'approved_to_send',
    'sent', 'failed_send', 'submitted', 'expired', 'duplicate',
    'blocked_risk', 'not_a_fit', 'withdrawn', 'needs_manual_attention'
  )),
  private_notes text NOT NULL DEFAULT '' CHECK (length(private_notes) <= 12000),
  followup_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.jr_applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.jr_applications FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS jr_applications_state_updated_idx
  ON public.jr_applications (state, updated_at DESC);
CREATE INDEX IF NOT EXISTS jr_applications_followup_idx
  ON public.jr_applications (followup_at) WHERE followup_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.jr_application_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.jr_applications(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  event text NOT NULL CHECK (length(event) BETWEEN 1 AND 100),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.jr_application_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.jr_application_events FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS jr_application_events_timeline_idx
  ON public.jr_application_events (application_id, at DESC, id);

CREATE OR REPLACE FUNCTION public.jr_reject_application_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Career application events are append-only';
END;
$$;
DROP TRIGGER IF EXISTS jr_application_events_append_only ON public.jr_application_events;
CREATE TRIGGER jr_application_events_append_only
  BEFORE UPDATE OR DELETE ON public.jr_application_events
  FOR EACH ROW EXECUTE FUNCTION public.jr_reject_application_event_mutation();

COMMIT;
