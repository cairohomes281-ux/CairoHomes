-- 039: Petty cash fields for owner cost attribution + expense linking

ALTER TABLE public.petty_cash
  ADD COLUMN IF NOT EXISTS unit_id uuid REFERENCES public.units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS paid_by text DEFAULT 'company',
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS is_advance integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS res_from_date date,
  ADD COLUMN IF NOT EXISTS res_to_date date,
  ADD COLUMN IF NOT EXISTS moved_to text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'petty_cash_paid_by_check'
  ) THEN
    ALTER TABLE public.petty_cash
      ADD CONSTRAINT petty_cash_paid_by_check
      CHECK (paid_by IS NULL OR paid_by = ANY (ARRAY['company'::text, 'owner'::text, 'tenant'::text]));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'petty_cash_status_check'
  ) THEN
    ALTER TABLE public.petty_cash
      ADD CONSTRAINT petty_cash_status_check
      CHECK (status IS NULL OR status = ANY (ARRAY['open'::text, 'moved'::text]));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_petty_cash_unit_id ON public.petty_cash (unit_id);
CREATE INDEX IF NOT EXISTS idx_petty_cash_paid_by ON public.petty_cash (paid_by);
