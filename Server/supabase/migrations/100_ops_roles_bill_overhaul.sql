-- Ops roles / bills overhaul:
-- 1) Staff task completion comments
-- 2) Remap housekeeping roles → operations; drop HK roles from CHECK
-- 3) Petty cash transfer proof on cash-out

-- ── Staff task completion comment ───────────────────────────────────────────
ALTER TABLE public.staff_tasks
  ADD COLUMN IF NOT EXISTS completion_comment text;

-- ── Petty cash transfer proof ───────────────────────────────────────────────
ALTER TABLE public.petty_cash
  ADD COLUMN IF NOT EXISTS transfer_proof_path text,
  ADD COLUMN IF NOT EXISTS transfer_proof_name text;

-- ── Merge housekeeping roles into operations ────────────────────────────────
UPDATE public.staff_users
SET role = 'operations_supervisor',
    updated_at = COALESCE(updated_at, now())
WHERE role = 'housekeeping_supervisor';

UPDATE public.staff_users
SET role = 'operations',
    updated_at = COALESCE(updated_at, now())
WHERE role = 'housekeeping';

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'staff_users'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.staff_users DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.staff_users
  ADD CONSTRAINT staff_users_role_check
  CHECK (role = ANY (ARRAY[
    'admin',
    'reservations',
    'reservations_web',
    'reservations_manual',
    'reservations_manager',
    'unit_acquisition_agent',
    'unit_acquisition_manager',
    'operations',
    'operations_supervisor',
    'resale',
    'resale_manager',
    'finance',
    'finance_manager',
    'hr',
    'hr_supervisor',
    'owners_relations',
    'owner',
    'marketing_pr',
    'web_developer'
  ]));
