-- Per-unit: when true, guests cannot book online — WhatsApp inquiry only.
ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS disable_automatic_reservations boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.units.disable_automatic_reservations IS
  'When true, guest site hides Reserve and blocks checkout/quote; WhatsApp inquiry only.';
