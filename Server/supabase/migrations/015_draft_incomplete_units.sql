-- Demote published units that are missing guest-listing essentials.
-- Complete drafts are left as draft (intentional hold).

UPDATE units
SET status = 'draft', updated_at = now()
WHERE status = 'published'
  AND (
    title IS NULL OR btrim(title) = ''
    OR (
      (compound IS NULL OR btrim(compound) = '')
      AND (project IS NULL OR btrim(project) = '')
    )
    OR property_type IS NULL OR btrim(property_type) = ''
    OR beds IS NULL
    OR baths IS NULL
    OR guests IS NULL OR guests < 1
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
