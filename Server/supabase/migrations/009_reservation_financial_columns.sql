-- Reservation financial fields used by commissions, utilities, and housekeeping

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS price_per_night real DEFAULT 0,
  ADD COLUMN IF NOT EXISTS housekeeping_fees real DEFAULT 0,
  ADD COLUMN IF NOT EXISTS insurance real DEFAULT 0,
  ADD COLUMN IF NOT EXISTS down_payment real DEFAULT 0,
  ADD COLUMN IF NOT EXISTS utilities_amount real DEFAULT 0,
  ADD COLUMN IF NOT EXISTS utilities_cost_override real,
  ADD COLUMN IF NOT EXISTS broker_name text,
  ADD COLUMN IF NOT EXISTS broker_amount_per_night real DEFAULT 0,
  ADD COLUMN IF NOT EXISTS broker_total real DEFAULT 0,
  ADD COLUMN IF NOT EXISTS owner_collected_type varchar(20),
  ADD COLUMN IF NOT EXISTS owner_collected_amount real DEFAULT 0;

-- Backfill price_per_night from total / nights when missing
UPDATE public.reservations
SET price_per_night = ROUND((total_amount / NULLIF(nights, 0))::numeric, 2)::real
WHERE COALESCE(price_per_night, 0) = 0
  AND COALESCE(nights, 0) > 0
  AND COALESCE(total_amount, 0) > 0;
