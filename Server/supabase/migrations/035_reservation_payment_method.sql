-- Preferred collection method on manual reservations (cash / Instapay)

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS payment_method varchar(50);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reservations_payment_method_check'
  ) THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_payment_method_check
      CHECK (
        payment_method IS NULL
        OR payment_method = ANY (ARRAY[
          'cash','instapay','bank_transfer','credit_card','online','paymob_card'
        ])
      );
  END IF;
END $$;
