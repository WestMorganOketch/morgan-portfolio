-- manual, never auto-run. This removes encrypted vault metadata and consent history.
-- It does not delete encrypted objects from Supabase Storage; review and remove those separately if rolling back.
-- Confirm a backup and retain any required audit history before running.
BEGIN;
DROP TRIGGER IF EXISTS jr_career_document_consent_append_only ON public.jr_career_document_consents;
DROP FUNCTION IF EXISTS public.jr_reject_career_document_consent_mutation();
DROP TABLE IF EXISTS public.jr_career_document_consents;
DROP TABLE IF EXISTS public.jr_career_documents;
COMMIT;
