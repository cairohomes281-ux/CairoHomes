-- Operations + Housekeeping daily check-in handover fields and roles.

DO $$
DECLARE
  conname text;
BEGIN
  FOR conname IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'staff_users'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.staff_users DROP CONSTRAINT %I', conname);
  END LOOP;
END $$;

ALTER TABLE public.staff_users
  ADD CONSTRAINT staff_users_role_check
  CHECK (role = ANY (ARRAY[
    'admin',
    'reservations',
    'reservations_web',
    'reservations_manual',
    'operations',
    'housekeeping',
    'resale',
    'hr',
    'owner'
  ]));

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS ops_money_collected integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ops_money_collected_at timestamptz,
  ADD COLUMN IF NOT EXISTS ops_money_collected_by integer REFERENCES public.staff_users(id),
  ADD COLUMN IF NOT EXISTS ops_money_collected_amount real DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ops_handed_over integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ops_handed_over_at timestamptz,
  ADD COLUMN IF NOT EXISTS ops_handed_over_by integer REFERENCES public.staff_users(id);

-- Already fully paid stays: treat money as collected for ops UI.
UPDATE public.reservations
SET ops_money_collected = 1,
    ops_money_collected_amount = GREATEST(0, COALESCE(total_amount, 0) - COALESCE(amount_paid, 0)),
    ops_money_collected_at = COALESCE(ops_money_collected_at, now())
WHERE COALESCE(ops_money_collected, 0) = 0
  AND COALESCE(payment_status, '') = 'paid'
  AND COALESCE(total_amount, 0) - COALESCE(amount_paid, 0) <= 0.5;
