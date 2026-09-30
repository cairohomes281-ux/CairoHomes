CREATE TABLE IF NOT EXISTS cash_forecast_entries (
  id SERIAL PRIMARY KEY,
  week_start DATE NOT NULL,
  category TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  is_actual BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_by INT REFERENCES staff_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
