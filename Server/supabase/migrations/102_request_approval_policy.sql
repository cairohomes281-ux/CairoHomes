-- Align pending request approval flags with:
-- leave/WFH: direct manager + HR Manager
-- loans: Financial Manager + HR Manager (no line manager for regular staff)

UPDATE public.staff_leave_requests
SET
  needs_manager_approval = true,
  needs_hr_approval = true
WHERE status = 'pending';

UPDATE public.staff_wfh_requests
SET
  needs_manager_approval = true,
  needs_hr_approval = true
WHERE status = 'pending';

-- Regular staff loans drop the manager step; keep manager for Finance/HR Manager self-requests.
UPDATE public.staff_loan_requests r
SET needs_manager_approval = false
FROM public.staff_users u
WHERE r.staff_user_id = u.id
  AND r.status = 'pending'
  AND u.role NOT IN ('finance_manager', 'hr_supervisor');

UPDATE public.staff_loan_requests
SET needs_finance_approval = true
WHERE status = 'pending'
  AND needs_finance_approval IS DISTINCT FROM true
  AND staff_user_id IN (
    SELECT id FROM public.staff_users WHERE role <> 'finance_manager'
  );

UPDATE public.staff_loan_requests
SET needs_hr_approval = true
WHERE status = 'pending'
  AND needs_hr_approval IS DISTINCT FROM true
  AND staff_user_id IN (
    SELECT id FROM public.staff_users WHERE role <> 'hr_supervisor'
  );
