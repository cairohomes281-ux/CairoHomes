-- Replace the resale ('sale') listing type with long-term rentals.
-- Long-term units: monthly price, their own min stay (not synced from the project),
-- guests can only view availability and inquire (no online booking).

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS price_monthly_egp numeric(12,2);

ALTER TABLE public.units
  DROP CONSTRAINT IF EXISTS units_listing_type_check;

-- Converted units stay hidden as drafts until they have a monthly price and a min stay.
UPDATE public.units
SET listing_type = 'long_term',
    min_nights = NULL,
    status = CASE WHEN status = 'published' THEN 'draft' ELSE status END,
    updated_at = now()
WHERE listing_type = 'sale';

ALTER TABLE public.units
  ADD CONSTRAINT units_listing_type_check
    CHECK (listing_type IN ('rent', 'long_term'));

COMMENT ON COLUMN public.units.listing_type IS
  'rent = short-stay inventory (bookable online); long_term = long-term rental (inquiry only, own min stay)';
COMMENT ON COLUMN public.units.price_monthly_egp IS
  'Monthly rent shown on the guest site for long_term units';
COMMENT ON COLUMN public.units.min_nights IS
  'Minimum stay. Synced from the project for rent units; set per unit for long_term units';
