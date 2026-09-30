-- 044_promo_code_redemptions.sql
-- Track promo usage once per guest + admin-friendly metadata

ALTER TABLE public.promo_codes
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS once_per_guest boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.promo_code_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id uuid NOT NULL REFERENCES public.promo_codes(id) ON DELETE CASCADE,
  guest_key text NOT NULL,
  guest_email text,
  guest_phone text,
  guest_id uuid,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  discount_amount integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promo_code_redemptions_once_per_guest UNIQUE (promo_code_id, guest_key)
);

CREATE INDEX IF NOT EXISTS idx_promo_code_redemptions_promo
  ON public.promo_code_redemptions (promo_code_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_promo_code_redemptions_guest
  ON public.promo_code_redemptions (guest_key);
