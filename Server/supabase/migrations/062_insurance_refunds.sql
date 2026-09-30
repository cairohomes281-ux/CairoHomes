-- Guest insurance is collected at check-in (liability 204000) and refunded at checkout.
-- Partial refunds retain damage against insurance_damage_amount / revenue 410000.

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS insurance_refund_status varchar(20),
  ADD COLUMN IF NOT EXISTS insurance_refunded_amount real DEFAULT 0,
  ADD COLUMN IF NOT EXISTS insurance_damage_amount real DEFAULT 0,
  ADD COLUMN IF NOT EXISTS insurance_refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS insurance_refund_method varchar(40),
  ADD COLUMN IF NOT EXISTS insurance_refund_notes text,
  ADD COLUMN IF NOT EXISTS insurance_refunded_by integer REFERENCES staff_users(id);

COMMENT ON COLUMN reservations.insurance_refund_status IS
  'null/pending = not settled; refunded | partial | forfeited once settled at checkout';

CREATE INDEX IF NOT EXISTS idx_reservations_insurance_refund_due
  ON reservations (check_out)
  WHERE COALESCE(insurance, 0) > 0
    AND (insurance_refund_status IS NULL OR insurance_refund_status = 'pending');
