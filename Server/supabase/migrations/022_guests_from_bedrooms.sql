-- Capacity = 2 × bedrooms; studio (0 / null beds) → 2 guests
UPDATE units
SET guests = CASE
  WHEN beds IS NULL OR beds <= 0 THEN 2
  ELSE beds * 2
END,
updated_at = now()
WHERE guests IS DISTINCT FROM CASE
  WHEN beds IS NULL OR beds <= 0 THEN 2
  ELSE beds * 2
END;
