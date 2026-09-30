-- AR collection actions / dunning log
CREATE TABLE IF NOT EXISTS ar_collection_actions (
  id SERIAL PRIMARY KEY,
  reservation_id INT NOT NULL,
  action_type TEXT NOT NULL, -- 'reminder_sent', 'phone_call', 'final_notice', 'write_off_proposed', 'dispute', 'payment_plan'
  notes TEXT,
  next_action_date DATE,
  amount_disputed NUMERIC(12,2) DEFAULT 0,
  created_by INT REFERENCES staff_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bad debt provisions
CREATE TABLE IF NOT EXISTS ar_bad_debt_provisions (
  id SERIAL PRIMARY KEY,
  period_month TEXT NOT NULL, -- 'YYYY-MM'
  bucket_0_30_pct NUMERIC(5,2) DEFAULT 0, -- Expected loss % for current bucket
  bucket_31_60_pct NUMERIC(5,2) DEFAULT 1,
  bucket_61_90_pct NUMERIC(5,2) DEFAULT 5,
  bucket_90_plus_pct NUMERIC(5,2) DEFAULT 20,
  total_ar NUMERIC(12,2) DEFAULT 0,
  total_provision NUMERIC(12,2) DEFAULT 0,
  notes TEXT,
  created_by INT REFERENCES staff_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(period_month)
);

-- AR write-offs
CREATE TABLE IF NOT EXISTS ar_write_offs (
  id SERIAL PRIMARY KEY,
  reservation_id INT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  reason TEXT,
  approved_by INT REFERENCES staff_users(id),
  approved_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending', -- pending, approved, rejected
  created_by INT REFERENCES staff_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
