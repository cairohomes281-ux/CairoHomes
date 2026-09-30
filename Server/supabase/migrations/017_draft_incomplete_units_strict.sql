-- Demote published units missing any guest-listing attribute.
-- Books require: identity, specs, price, photos, description, amenities,
-- location, utilities, beach access fees.

UPDATE units
SET status = 'draft', updated_at = now()
WHERE status = 'published'
  AND (
    title IS NULL OR btrim(title) = ''
    OR (
      (compound IS NULL OR btrim(compound) = '')
      AND (project IS NULL OR btrim(project) = '')
    )
    OR area IS NULL OR btrim(area) = ''
    OR property_type IS NULL OR btrim(property_type) = ''
    OR unit_number IS NULL OR btrim(unit_number) = ''
    OR view IS NULL OR btrim(view) = ''
    OR beds IS NULL
    OR baths IS NULL
    OR floor IS NULL OR btrim(floor::text) = ''
    OR guests IS NULL OR guests < 1
    OR min_nights IS NULL OR min_nights < 1
    OR utilities_cost IS NULL
    OR access_fee_per_adult_egp IS NULL
    OR access_fee_per_teen_egp IS NULL
    OR access_card_count_included IS NULL OR access_card_count_included < 1
    OR (
      (the_property IS NULL OR btrim(the_property) = '')
      AND (short_description IS NULL OR btrim(short_description) = '')
    )
    OR amenities IS NULL OR cardinality(amenities) = 0
    OR source_url IS NULL OR btrim(source_url) = ''
    OR (
      (price_fallback IS NULL OR price_fallback <= 0)
      AND (
        wp_post_id IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM unit_daily_prices udp
          WHERE udp.wp_post_id = units.wp_post_id
            AND udp.price > 0
        )
      )
    )
    OR (
      (cover_url IS NULL OR btrim(cover_url) = '')
      AND (photo_urls IS NULL OR cardinality(photo_urls) = 0)
    )
  );
