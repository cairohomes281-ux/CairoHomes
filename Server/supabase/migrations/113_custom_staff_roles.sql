-- Custom staff roles created from User Management.
-- A custom role is a named variant of a built-in role: staff_users.role keeps the base role
-- (so every server permission check is unchanged) and custom_role_id adds the custom name
-- plus the subset of PMS pages the role can see.

CREATE TABLE IF NOT EXISTS public.staff_roles (
  id serial PRIMARY KEY,
  name text NOT NULL,
  description text,
  base_role text NOT NULL,
  pages text[] NOT NULL DEFAULT '{}',
  created_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_roles_base_role_check CHECK (base_role <> 'owner')
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_roles_name_lower_uniq
  ON public.staff_roles (lower(name));

ALTER TABLE public.staff_roles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.staff_users
  ADD COLUMN IF NOT EXISTS custom_role_id integer
    REFERENCES public.staff_roles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS staff_users_custom_role_id_idx
  ON public.staff_users (custom_role_id);

COMMENT ON TABLE public.staff_roles IS
  'Custom staff roles: a display name and page subset layered on a built-in base role';
COMMENT ON COLUMN public.staff_users.custom_role_id IS
  'Optional custom role; staff_users.role always holds its base role';
