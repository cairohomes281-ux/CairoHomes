-- 040: Attribute owner-paid expenses / petty cash to a specific owner

ALTER TABLE public.petty_cash
  ADD COLUMN IF NOT EXISTS owner_id integer REFERENCES public.staff_users(id) ON DELETE SET NULL;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS owner_id integer REFERENCES public.staff_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_petty_cash_owner_id ON public.petty_cash (owner_id);
CREATE INDEX IF NOT EXISTS idx_expenses_owner_id ON public.expenses (owner_id);
