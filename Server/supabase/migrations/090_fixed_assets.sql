CREATE TABLE IF NOT EXISTS fixed_assets (
  id SERIAL PRIMARY KEY,
  asset_code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'equipment',
  account_code TEXT NOT NULL DEFAULT '150000',
  depreciation_account TEXT NOT NULL DEFAULT '159000',
  expense_account TEXT NOT NULL DEFAULT '606000',
  purchase_date DATE NOT NULL,
  purchase_cost NUMERIC(12,2) NOT NULL,
  salvage_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  useful_life_months INT NOT NULL DEFAULT 36,
  depreciation_method TEXT NOT NULL DEFAULT 'straight_line',
  status TEXT NOT NULL DEFAULT 'active',
  disposed_date DATE,
  disposed_amount NUMERIC(12,2),
  notes TEXT,
  unit_id UUID REFERENCES units(id),
  created_by INT REFERENCES staff_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fixed_asset_depreciation (
  id SERIAL PRIMARY KEY,
  asset_id INT NOT NULL REFERENCES fixed_assets(id),
  period_month TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  accumulated NUMERIC(12,2) NOT NULL,
  book_value NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(asset_id, period_month)
);
