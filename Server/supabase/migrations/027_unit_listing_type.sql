-- Rent vs sale inventory on the same units table.
ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS listing_type varchar(16) NOT NULL DEFAULT 'rent';

ALTER TABLE public.units
  DROP CONSTRAINT IF EXISTS units_listing_type_check;

ALTER TABLE public.units
  ADD CONSTRAINT units_listing_type_check
  CHECK (listing_type IN ('rent', 'sale'));

CREATE INDEX IF NOT EXISTS idx_units_listing_type ON public.units (listing_type);

COMMENT ON COLUMN public.units.listing_type IS 'rent = short-stay inventory; sale = resale inventory';
COMMENT ON COLUMN public.units.size_m2 IS 'Unit area in m² — required for sale listings';
