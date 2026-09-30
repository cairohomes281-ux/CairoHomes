-- Townhouse is treated as Villa across the product.
UPDATE public.units
SET property_type = 'Villa',
    updated_at = now()
WHERE property_type IS NOT NULL
  AND regexp_replace(lower(btrim(property_type)), '[\s_\-]+', '', 'g')
      IN ('townhouse', 'townhome');

UPDATE public.acquisition_leads
SET property_type = 'Villa',
    updated_at = now()
WHERE property_type IS NOT NULL
  AND regexp_replace(lower(btrim(property_type)), '[\s_\-]+', '', 'g')
      IN ('townhouse', 'townhome');
