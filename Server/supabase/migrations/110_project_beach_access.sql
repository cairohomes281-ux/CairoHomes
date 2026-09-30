-- Access-fee policy (beach / club / compound access) lives on projects; units inherit it.

ALTER TABLE public.location_projects
  ADD COLUMN IF NOT EXISTS beach_access_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS beach_access_mode text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS beach_access_adult_egp numeric(12,2),
  ADD COLUMN IF NOT EXISTS beach_access_extra_egp numeric(12,2),
  ADD COLUMN IF NOT EXISTS beach_access_days integer,
  ADD COLUMN IF NOT EXISTS beach_access_flat_egp numeric(12,2),
  ADD COLUMN IF NOT EXISTS beach_access_flat_studio_egp numeric(12,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'location_projects_beach_access_mode_check'
  ) THEN
    ALTER TABLE public.location_projects
      ADD CONSTRAINT location_projects_beach_access_mode_check
      CHECK (beach_access_mode IN ('none', 'per_guest', 'flat', 'free', 'tiered'));
  END IF;
END $$;

COMMENT ON COLUMN public.location_projects.beach_access_enabled IS
  'When false, units in this project charge no access fee.';
COMMENT ON COLUMN public.location_projects.beach_access_mode IS
  'none | per_guest | flat | free | tiered';
