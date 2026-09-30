-- Vendor master
CREATE TABLE IF NOT EXISTS vendors (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  tax_id TEXT,
  category TEXT DEFAULT 'general',
  payment_terms_days INT DEFAULT 30,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  bank_name TEXT,
  bank_account TEXT,
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  wht_rate_pct NUMERIC(4,2) DEFAULT 3,
  created_by INT REFERENCES staff_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vendor invoices (AP bills)
CREATE TABLE IF NOT EXISTS vendor_invoices (
  id SERIAL PRIMARY KEY,
  vendor_id INT NOT NULL REFERENCES vendors(id),
  invoice_number TEXT,
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  wht_amount NUMERIC(12,2) DEFAULT 0,
  net_payable NUMERIC(12,2) NOT NULL,
  description TEXT,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  approved_by INT REFERENCES staff_users(id),
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  paid_by INT REFERENCES staff_users(id),
  payment_method TEXT,
  payment_reference TEXT,
  expense_id INT,
  unit_id UUID REFERENCES units(id),
  notes TEXT,
  created_by INT REFERENCES staff_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payment runs
CREATE TABLE IF NOT EXISTS payment_runs (
  id SERIAL PRIMARY KEY,
  run_date DATE NOT NULL,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_wht NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_net NUMERIC(12,2) NOT NULL DEFAULT 0,
  invoice_count INT DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT,
  created_by INT REFERENCES staff_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_run_items (
  id SERIAL PRIMARY KEY,
  run_id INT NOT NULL REFERENCES payment_runs(id),
  invoice_id INT NOT NULL REFERENCES vendor_invoices(id),
  amount NUMERIC(12,2) NOT NULL,
  wht_amount NUMERIC(12,2) DEFAULT 0,
  net_payable NUMERIC(12,2) NOT NULL
);
