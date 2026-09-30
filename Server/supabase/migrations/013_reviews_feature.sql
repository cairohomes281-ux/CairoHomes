-- Guest reviews enhancements (hospitality-standard)
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS guest_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reviews_unit_published
  ON public.reviews (unit_id, created_at DESC)
  WHERE published = true;

CREATE INDEX IF NOT EXISTS idx_reviews_wp_published
  ON public.reviews (listing_wp_id, created_at DESC)
  WHERE published = true;

-- Optional denormalized aggregates on units (kept in sync on create/hide)
ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS average_rating numeric(3,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS review_count integer NOT NULL DEFAULT 0;

-- Backfill from existing published reviews
UPDATE public.units u
SET
  average_rating = COALESCE(s.avg_rating, 0),
  review_count = COALESCE(s.cnt, 0)
FROM (
  SELECT
    unit_id,
    ROUND(AVG(rating)::numeric, 2) AS avg_rating,
    COUNT(*)::int AS cnt
  FROM public.reviews
  WHERE published = true AND unit_id IS NOT NULL
  GROUP BY unit_id
) s
WHERE u.id = s.unit_id;
