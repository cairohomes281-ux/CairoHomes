-- Manual journal From/To accounts for Financial System entries.

ALTER TABLE public.financial_manual_entries
  ADD COLUMN IF NOT EXISTS debit_account_code text,
  ADD COLUMN IF NOT EXISTS credit_account_code text;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.financial_manual_entries'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%entry_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.financial_manual_entries DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.financial_manual_entries
  ADD CONSTRAINT financial_manual_entries_entry_type_check
  CHECK (entry_type = ANY (ARRAY[
    'revenue'::text,
    'expense'::text,
    'miscellaneous'::text,
    'journal'::text
  ]));

ALTER TABLE public.financial_manual_entries
  DROP CONSTRAINT IF EXISTS financial_manual_entries_misc_flow_type_check;

ALTER TABLE public.financial_manual_entries
  ADD CONSTRAINT financial_manual_entries_misc_flow_type_check
  CHECK (
    (entry_type = 'miscellaneous' AND misc_flow = ANY (ARRAY['in'::text, 'out'::text]))
    OR (entry_type <> 'miscellaneous' AND misc_flow IS NULL)
  );

-- Backfill legacy hard-coded postings.
UPDATE public.financial_manual_entries
SET
  debit_account_code = COALESCE(debit_account_code, CASE
    WHEN entry_type = 'revenue' THEN '101000'
    WHEN entry_type = 'expense' THEN '503000'
    WHEN misc_flow = 'out' THEN '503000'
    ELSE '101000'
  END),
  credit_account_code = COALESCE(credit_account_code, CASE
    WHEN entry_type = 'revenue' THEN '409000'
    WHEN entry_type = 'expense' THEN '201000'
    WHEN misc_flow = 'out' THEN '101000'
    ELSE '409000'
  END)
WHERE debit_account_code IS NULL OR credit_account_code IS NULL;
