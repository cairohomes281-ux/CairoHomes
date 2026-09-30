-- Line managers + dual approval for leave, loans, and WFH.

ALTER TABLE public.staff_users
  ADD COLUMN IF NOT EXISTS manager_id integer REFERENCES public.staff_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS staff_users_manager_id_idx
  ON public.staff_users (manager_id);

ALTER TABLE public.staff_users
  DROP CONSTRAINT IF EXISTS staff_users_manager_not_self;

ALTER TABLE public.staff_users
  ADD CONSTRAINT staff_users_manager_not_self
  CHECK (manager_id IS NULL OR manager_id <> id);

ALTER TABLE public.staff_leave_requests
  ADD COLUMN IF NOT EXISTS needs_manager_approval boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS needs_hr_approval boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS manager_reviewed_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manager_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS hr_reviewed_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hr_reviewed_at timestamptz;

ALTER TABLE public.staff_loan_requests
  ADD COLUMN IF NOT EXISTS needs_manager_approval boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS needs_hr_approval boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS manager_reviewed_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manager_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS hr_reviewed_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hr_reviewed_at timestamptz;

ALTER TABLE public.staff_wfh_requests
  ADD COLUMN IF NOT EXISTS needs_manager_approval boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS needs_hr_approval boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS manager_reviewed_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manager_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS hr_reviewed_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hr_reviewed_at timestamptz;

UPDATE public.staff_leave_requests lr
SET
  needs_manager_approval = CASE WHEN u.role IN ('hr', 'admin') THEN false ELSE true END,
  needs_hr_approval = CASE WHEN u.role IN ('hr_supervisor', 'admin') THEN false ELSE true END
FROM public.staff_users u
WHERE u.id = lr.staff_user_id;

UPDATE public.staff_loan_requests r
SET
  needs_manager_approval = CASE WHEN u.role IN ('hr', 'admin') THEN false ELSE true END,
  needs_hr_approval = CASE WHEN u.role IN ('hr_supervisor', 'admin') THEN false ELSE true END
FROM public.staff_users u
WHERE u.id = r.staff_user_id;

UPDATE public.staff_wfh_requests r
SET
  needs_manager_approval = CASE WHEN u.role IN ('hr', 'admin') THEN false ELSE true END,
  needs_hr_approval = CASE WHEN u.role IN ('hr_supervisor', 'admin') THEN false ELSE true END
FROM public.staff_users u
WHERE u.id = r.staff_user_id;

UPDATE public.staff_leave_requests
SET
  manager_reviewed_by = CASE WHEN needs_manager_approval THEN reviewed_by ELSE manager_reviewed_by END,
  manager_reviewed_at = CASE WHEN needs_manager_approval THEN reviewed_at ELSE manager_reviewed_at END,
  hr_reviewed_by = CASE WHEN needs_hr_approval THEN reviewed_by ELSE hr_reviewed_by END,
  hr_reviewed_at = CASE WHEN needs_hr_approval THEN reviewed_at ELSE hr_reviewed_at END
WHERE status IN ('approved', 'rejected') AND reviewed_by IS NOT NULL;

UPDATE public.staff_loan_requests
SET
  manager_reviewed_by = CASE WHEN needs_manager_approval THEN reviewed_by ELSE manager_reviewed_by END,
  manager_reviewed_at = CASE WHEN needs_manager_approval THEN reviewed_at ELSE manager_reviewed_at END,
  hr_reviewed_by = CASE WHEN needs_hr_approval THEN reviewed_by ELSE hr_reviewed_by END,
  hr_reviewed_at = CASE WHEN needs_hr_approval THEN reviewed_at ELSE hr_reviewed_at END
WHERE status IN ('approved', 'rejected') AND reviewed_by IS NOT NULL;

UPDATE public.staff_wfh_requests
SET
  manager_reviewed_by = CASE WHEN needs_manager_approval THEN reviewed_by ELSE manager_reviewed_by END,
  manager_reviewed_at = CASE WHEN needs_manager_approval THEN reviewed_at ELSE manager_reviewed_at END,
  hr_reviewed_by = CASE WHEN needs_hr_approval THEN reviewed_by ELSE hr_reviewed_by END,
  hr_reviewed_at = CASE WHEN needs_hr_approval THEN reviewed_at ELSE hr_reviewed_at END
WHERE status IN ('approved', 'rejected') AND reviewed_by IS NOT NULL;
