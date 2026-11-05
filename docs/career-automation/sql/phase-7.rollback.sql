-- manual, never auto-run. This removes the published snapshot history and public endpoint data source.
-- Confirm backups and public-retention requirements before running.
BEGIN;
DROP TRIGGER IF EXISTS jr_public_snapshots_immutable ON public.jr_public_snapshots;
DROP FUNCTION IF EXISTS public.jr_reject_public_snapshot_mutation();
DROP TABLE IF EXISTS public.jr_public_snapshots;
COMMIT;
