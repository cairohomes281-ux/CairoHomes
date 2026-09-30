-- Host contact request fields on acquisition leads (website Become a Host form)
ALTER TABLE public.acquisition_leads
  ADD COLUMN IF NOT EXISTS furnishing_status text,
  ADD COLUMN IF NOT EXISTS preferred_contact_time text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS acquisition_leads_source_idx
  ON public.acquisition_leads (source);
