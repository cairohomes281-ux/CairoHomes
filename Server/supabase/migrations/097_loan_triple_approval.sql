-- Triple approval for loans: line manager → Financial Manager → HR Manager.
-- Reuses needs_manager_approval for the line manager; finance gets its own slot.

ALTER TABLE staff_loan_requests
  ADD COLUMN IF NOT EXISTS needs_finance_approval boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS finance_reviewed_by integer REFERENCES staff_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS finance_reviewed_at timestamptz;

-- Migrate legacy dual-approval where "manager" meant Financial Manager.
UPDATE staff_loan_requests
SET
  needs_finance_approval = COALESCE(needs_manager_approval, true),
  finance_reviewed_by = manager_reviewed_by,
  finance_reviewed_at = manager_reviewed_at
WHERE finance_reviewed_by IS NULL
  AND (
    manager_reviewed_by IS NOT NULL
    OR COALESCE(needs_manager_approval, true) = true
  );

-- Pending loans that already had finance approval: waive line-manager so HR can continue.
UPDATE staff_loan_requests
SET
  needs_manager_approval = false,
  manager_reviewed_by = NULL,
  manager_reviewed_at = NULL
WHERE status = 'pending'
  AND finance_reviewed_by IS NOT NULL;

-- Pending loans not yet reviewed: require line manager first, then finance.
UPDATE staff_loan_requests
SET
  needs_manager_approval = true,
  manager_reviewed_by = NULL,
  manager_reviewed_at = NULL
WHERE status = 'pending'
  AND finance_reviewed_by IS NULL;

-- Closed loans: keep finance history; line-manager flag not needed for display.
UPDATE staff_loan_requests
SET needs_manager_approval = false
WHERE status <> 'pending';

CREATE INDEX IF NOT EXISTS idx_staff_loan_finance_pending
  ON staff_loan_requests (status, finance_reviewed_by)
  WHERE status = 'pending';
