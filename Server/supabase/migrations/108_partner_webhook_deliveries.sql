CREATE TABLE IF NOT EXISTS public.partner_webhook_deliveries (
  id uuid PRIMARY KEY,
  event text NOT NULL,
  unit_id uuid,
  status text NOT NULL CHECK (status IN ('success', 'error', 'skipped')),
  http_status integer,
  error text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_webhook_deliveries_created
  ON public.partner_webhook_deliveries (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_partner_webhook_deliveries_unit
  ON public.partner_webhook_deliveries (unit_id, created_at DESC);
