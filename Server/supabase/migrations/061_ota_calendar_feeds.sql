-- Per-platform OTA calendar feeds (Airbnb, Booking.com, Travigo, etc.)
CREATE TABLE public.unit_ota_feeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  wp_post_id bigint NOT NULL,
  platform text NOT NULL CHECK (platform IN ('airbnb', 'booking', 'travigo', 'other')),
  label text,
  ical_url text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  last_sync_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, platform)
);

CREATE INDEX idx_unit_ota_feeds_wp ON public.unit_ota_feeds (wp_post_id);
CREATE INDEX idx_unit_ota_feeds_unit ON public.unit_ota_feeds (unit_id);

INSERT INTO public.unit_ota_feeds (unit_id, wp_post_id, platform, label, ical_url, updated_at)
SELECT
  u.id,
  li.wordpress_post_id,
  CASE
    WHEN li.ical_url ILIKE '%airbnb%' THEN 'airbnb'
    WHEN li.ical_url ILIKE '%booking.com%' THEN 'booking'
    WHEN li.ical_url ILIKE '%travago%' OR li.ical_url ILIKE '%trivago%' THEN 'travigo'
    ELSE 'other'
  END,
  li.notes,
  li.ical_url,
  li.updated_at
FROM public.listing_ical li
JOIN public.units u ON u.wp_post_id = li.wordpress_post_id
ON CONFLICT (unit_id, platform) DO UPDATE SET
  ical_url = EXCLUDED.ical_url,
  label = EXCLUDED.label,
  updated_at = EXCLUDED.updated_at;

ALTER TABLE public.unit_ical_blocks
  ADD COLUMN IF NOT EXISTS feed_id uuid REFERENCES public.unit_ota_feeds(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS platform text;

DELETE FROM public.unit_ical_blocks;

ALTER TABLE public.unit_ical_blocks DROP CONSTRAINT IF EXISTS unit_ical_blocks_pkey;
ALTER TABLE public.unit_ical_blocks ALTER COLUMN feed_id SET NOT NULL;
ALTER TABLE public.unit_ical_blocks ADD PRIMARY KEY (feed_id, date);
