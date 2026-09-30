-- Align job application statuses with hospitality-standard HR workflow

DO $$
DECLARE
  conname text;
BEGIN
  FOR conname IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'job_applications'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.job_applications DROP CONSTRAINT %I', conname);
  END LOOP;
END $$;

UPDATE public.job_applications
SET status = CASE lower(status)
  WHEN 'new' THEN 'Pending'
  WHEN 'reviewing' THEN 'Reviewed'
  WHEN 'interview' THEN 'Shortlisted'
  WHEN 'hired' THEN 'Shortlisted'
  WHEN 'rejected' THEN 'Rejected'
  WHEN 'pending' THEN 'Pending'
  WHEN 'reviewed' THEN 'Reviewed'
  WHEN 'shortlisted' THEN 'Shortlisted'
  ELSE status
END;

ALTER TABLE public.job_applications
  ALTER COLUMN status SET DEFAULT 'Pending';

ALTER TABLE public.job_applications
  ADD CONSTRAINT job_applications_status_check
  CHECK (status = ANY (ARRAY[
    'Pending', 'Reviewed', 'Shortlisted', 'Rejected',
    'new', 'reviewing', 'interview', 'hired', 'rejected'
  ]));
