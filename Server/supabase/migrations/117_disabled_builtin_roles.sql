-- Built-in staff roles deleted from User Management.
-- Their permissions stay defined in code; a row here only removes the role from every
-- role picker and blocks new assignments until it is restored.

CREATE TABLE IF NOT EXISTS public.staff_disabled_roles (
  role text PRIMARY KEY,
  disabled_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  disabled_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_disabled_roles_role_check CHECK (role NOT IN ('admin', 'owner'))
);

ALTER TABLE public.staff_disabled_roles ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.staff_disabled_roles IS
  'Built-in staff roles deleted from User Management; hidden from pickers and not assignable';
