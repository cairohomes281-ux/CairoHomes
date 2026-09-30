-- 046_project_min_nights.sql
-- Per-project minimum stay (nights) on Destinations & Projects catalog

ALTER TABLE public.location_projects
  ADD COLUMN IF NOT EXISTS min_nights integer NOT NULL DEFAULT 2;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'location_projects_min_nights_check'
  ) THEN
    ALTER TABLE public.location_projects
      ADD CONSTRAINT location_projects_min_nights_check CHECK (min_nights >= 1);
  END IF;
END $$;

-- Sync denormalized units.min_nights from matching project catalog rows
UPDATE public.units u
SET min_nights = lp.min_nights,
    updated_at = now()
FROM public.location_projects lp
WHERE lower(trim(COALESCE(u.project, ''))) = lp.normalized_name
   OR lower(trim(COALESCE(u.compound, ''))) = lp.normalized_name;

-- Units with no catalog match keep their own value (default 2)
UPDATE public.units
SET min_nights = COALESCE(NULLIF(min_nights, 0), 2),
    updated_at = now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.location_projects lp
  WHERE lower(trim(COALESCE(units.project, ''))) = lp.normalized_name
     OR lower(trim(COALESCE(units.compound, ''))) = lp.normalized_name
);
