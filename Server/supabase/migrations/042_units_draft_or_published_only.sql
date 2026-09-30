-- 042: Units listing status is only draft | published (no archived/cancelled/delisted).
-- Incomplete → draft, complete → published (app sync also enforces this).

-- Normalize any legacy terminal statuses to draft first; completeness sync publishes when ready.
UPDATE public.units
SET status = 'draft', updated_at = now()
WHERE status IS DISTINCT FROM 'draft'
  AND status IS DISTINCT FROM 'published';

ALTER TABLE public.units DROP CONSTRAINT IF EXISTS units_status_check;

ALTER TABLE public.units
  ADD CONSTRAINT units_status_check
  CHECK (status = ANY (ARRAY['draft', 'published']));
