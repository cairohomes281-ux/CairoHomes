-- Let reservations and ops collections use common guest currencies.
-- Amounts remain stored in EGP; currency + exchange_rate describe the agreed / collected money.

ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_currency_check;
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_currency_check
  CHECK (currency IN ('EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED', 'KWD', 'QAR'));

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'EGP',
  ADD COLUMN IF NOT EXISTS amount_original numeric,
  ADD COLUMN IF NOT EXISTS exchange_rate numeric NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_currency_check'
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_currency_check
      CHECK (currency IN ('EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED', 'KWD', 'QAR'));
  END IF;
END $$;

COMMENT ON COLUMN public.payments.amount IS
  'Amount in EGP (system of record for balances and finance).';
COMMENT ON COLUMN public.payments.amount_original IS
  'Amount as collected in payments.currency before converting to EGP.';
COMMENT ON COLUMN public.payments.exchange_rate IS
  'EGP per 1 unit of payments.currency at collection time.';
