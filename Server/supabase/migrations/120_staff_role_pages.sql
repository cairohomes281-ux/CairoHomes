-- CEO-chosen page lists for built-in staff roles. No row = the role's default pages.
CREATE TABLE IF NOT EXISTS public.staff_role_pages (
  role text PRIMARY KEY,
  pages text[] NOT NULL DEFAULT '{}',
  updated_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_role_pages_role_check CHECK (role NOT IN ('admin', 'owner'))
);

ALTER TABLE public.staff_role_pages ENABLE ROW LEVEL SECURITY;
