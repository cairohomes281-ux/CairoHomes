-- Persist real beach-access total on the reservation (ops / imports).
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS beach_access_fees numeric(12,2) DEFAULT 0;

COMMENT ON COLUMN reservations.beach_access_fees IS
  'Actual beach / access cards amount for this stay (not recomputed from unit rates).';
