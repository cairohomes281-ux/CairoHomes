-- Simplify acquisition leads to contact statuses (no pipeline stages)
ALTER TABLE public.acquisition_leads
  DROP CONSTRAINT IF EXISTS acquisition_leads_stage_check;

UPDATE public.acquisition_leads
SET stage = CASE
  WHEN stage IN ('contract_signed', 'live', 'signed') THEN 'signed'
  WHEN stage IN ('rejected') THEN 'rejected'
  ELSE 'pending'
END;

ALTER TABLE public.acquisition_leads
  ALTER COLUMN stage SET DEFAULT 'pending';

ALTER TABLE public.acquisition_leads
  ADD CONSTRAINT acquisition_leads_stage_check
  CHECK (stage = ANY (ARRAY['pending', 'signed', 'rejected']));
