-- Allow Visa as a payment / collection method

DO $$
DECLARE
  conname text;
BEGIN
  SELECT c.conname INTO conname
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND t.relname = 'payments'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%payment_method%'
  LIMIT 1;

  IF conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.payments DROP CONSTRAINT %I', conname);
  END IF;
END $$;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_payment_method_check
  CHECK (
    payment_method = ANY (ARRAY[
      'cash','bank_transfer','credit_card','online','paymob_card','instapay','visa'
    ])
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reservations_payment_method_check'
  ) THEN
    ALTER TABLE public.reservations DROP CONSTRAINT reservations_payment_method_check;
  END IF;
END $$;

ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_payment_method_check
  CHECK (
    payment_method IS NULL
    OR payment_method = ANY (ARRAY[
      'cash','instapay','bank_transfer','credit_card','online','paymob_card','visa'
    ])
  );
