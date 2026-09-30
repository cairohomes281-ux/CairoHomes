CREATE TABLE IF NOT EXISTS close_checklist_templates (
  id SERIAL PRIMARY KEY,
  task_order INT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  owner_role TEXT,
  required_before_close BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO close_checklist_templates (task_order, title, description, owner_role, required_before_close) VALUES
  (1, 'Bank reconciliation', 'Reconcile all bank accounts (101000, 102000) against bank statements', 'finance', true),
  (2, 'Cash reconciliation', 'Count and reconcile cash accounts (103000, 104000)', 'finance', true),
  (3, 'Gateway clearing', 'Settle all gateway transactions (106000) and verify MDR', 'finance', true),
  (4, 'AR aging review', 'Review guest AR aging (105000) and log collection actions for 60+ days', 'finance', true),
  (5, 'AP aging review', 'Review vendor invoices and process payment runs for due items', 'finance', true),
  (6, 'Owner trust tie-out', 'Reconcile owner trust subledger to control account 202000', 'finance_manager', true),
  (7, 'Insurance escrow review', 'Verify all checkout insurance refunds are processed (204000)', 'finance', true),
  (8, 'VAT reconciliation', 'Reconcile VAT output (205000) vs input (107000) and prepare return', 'finance', true),
  (9, 'WHT reconciliation', 'Verify WHT payable (206000) matches filed returns', 'finance', true),
  (10, 'Run depreciation', 'Run monthly depreciation for all active fixed assets', 'finance', false),
  (11, 'Review manual entries', 'Audit all manual journal entries for the period', 'finance_manager', true),
  (12, 'P&L review', 'Review profit and loss statement and investigate variances', 'finance_manager', true),
  (13, 'Balance sheet review', 'Verify balance sheet balances and ensure A = L + E', 'finance_manager', true),
  (14, 'Management sign-off', 'Final approval from finance manager before close', 'finance_manager', true)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS close_checklist_items (
  id SERIAL PRIMARY KEY,
  period_month TEXT NOT NULL,
  template_id INT REFERENCES close_checklist_templates(id),
  title TEXT NOT NULL,
  description TEXT,
  owner_role TEXT,
  status TEXT DEFAULT 'pending',
  completed_by INT REFERENCES staff_users(id),
  completed_at TIMESTAMPTZ,
  evidence_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_checklist_period_template ON close_checklist_items(period_month, template_id);
