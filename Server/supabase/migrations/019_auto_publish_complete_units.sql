-- Auto-publish units that already have every guest-listing field filled.
-- Incomplete units remain draft.

UPDATE units
SET status = 'published', updated_at = now()
WHERE status = 'draft'
  AND title IS NOT NULL AND btrim(title) <> ''
  AND (
    (compound IS NOT NULL AND btrim(compound) <> '')
    OR (project IS NOT NULL AND btrim(project) <> '')
  )
  AND area IS NOT NULL AND btrim(area) <> ''
  AND property_type IS NOT NULL AND btrim(property_type) <> ''
  AND unit_number IS NOT NULL AND btrim(unit_number) <> ''
  AND view IS NOT NULL AND btrim(view) <> ''
  AND beds IS NOT NULL
  AND baths IS NOT NULL
  AND floor IS NOT NULL AND btrim(floor::text) <> ''
  AND guests IS NOT NULL AND guests >= 1
  AND min_nights IS NOT NULL AND min_nights >= 1
  AND utilities_cost IS NOT NULL
  AND access_fee_per_adult_egp IS NOT NULL
  AND access_fee_per_teen_egp IS NOT NULL
  AND access_card_count_included IS NOT NULL AND access_card_count_included >= 1
  AND (
    (the_property IS NOT NULL AND btrim(the_property) <> '')
    OR (short_description IS NOT NULL AND btrim(short_description) <> '')
  )
  AND amenities IS NOT NULL AND cardinality(amenities) > 0
  AND source_url IS NOT NULL AND btrim(source_url) <> ''
  AND (
    (price_fallback IS NOT NULL AND price_fallback > 0)
    OR (
      wp_post_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM unit_daily_prices udp
        WHERE udp.wp_post_id = units.wp_post_id
          AND udp.price > 0
      )
    )
  )
  AND (
    (cover_url IS NOT NULL AND btrim(cover_url) <> '')
    OR (photo_urls IS NOT NULL AND cardinality(photo_urls) > 0)
  );
