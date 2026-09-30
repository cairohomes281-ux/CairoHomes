-- 038: Allow manual "actual utilities" expense category for P&L

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
      AND t.relname = 'expenses'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%category%'
  LOOP
    EXECUTE format('ALTER TABLE public.expenses DROP CONSTRAINT %I', conname);
  END LOOP;
END $$;

ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_category_check
  CHECK (category = ANY (ARRAY[
    'marketing'::text,
    'salary'::text,
    'housekeeping_cost'::text,
    'utilities_cost'::text,
    'other'::text
  ]));
