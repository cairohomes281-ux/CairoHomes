-- 043: Free-text sales / owner label on reservations (Excel "Sales / Owner")
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS sales_label text;
