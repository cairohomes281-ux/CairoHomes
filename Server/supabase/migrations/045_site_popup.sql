-- 045_site_popup.sql
-- Singleton website entry popup (one image at a time)

CREATE TABLE IF NOT EXISTS public.site_popup (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  image_url text NOT NULL,
  link_url text,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL
);
