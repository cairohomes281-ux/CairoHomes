-- Manual reservations can be quoted in USD. Amounts stay stored in EGP (so reports,
-- finance and owner statements keep working); currency + exchange_rate let the PMS
-- show the reservation in the currency it was agreed in.
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'EGP',
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(12,4) NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reservations_currency_check'
  ) THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_currency_check CHECK (currency IN ('EGP', 'USD'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reservations_exchange_rate_check'
  ) THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_exchange_rate_check CHECK (exchange_rate > 0);
  END IF;
END $$;
