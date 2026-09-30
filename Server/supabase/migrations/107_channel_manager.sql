-- Channel Manager: API connections, unit/rate mapping, sync logs.
-- iCal feeds remain in unit_ota_feeds (limited calendar fallback).

ALTER TABLE public.unit_ota_feeds
  ADD COLUMN IF NOT EXISTS external_listing_id text,
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'disconnected';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unit_ota_feeds_sync_status_check'
  ) THEN
    ALTER TABLE public.unit_ota_feeds
      ADD CONSTRAINT unit_ota_feeds_sync_status_check
      CHECK (sync_status IN ('connected', 'syncing', 'failed', 'disconnected'));
  END IF;
END $$;

UPDATE public.unit_ota_feeds
SET sync_status = CASE
  WHEN enabled = false THEN 'disconnected'
  WHEN last_sync_error IS NOT NULL AND last_sync_error <> '' THEN 'failed'
  WHEN last_sync_at IS NOT NULL THEN 'connected'
  ELSE 'disconnected'
END
WHERE sync_status = 'disconnected'
   OR sync_status IS NULL;

CREATE TABLE IF NOT EXISTS public.channel_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key text NOT NULL,
  connection_type text NOT NULL CHECK (connection_type IN ('api', 'ical')),
  display_name text,
  credentials jsonb NOT NULL DEFAULT '{}'::jsonb,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  sync_enabled boolean NOT NULL DEFAULT true,
  sync_status text NOT NULL DEFAULT 'disconnected'
    CHECK (sync_status IN ('connected', 'syncing', 'failed', 'disconnected')),
  last_sync_at timestamptz,
  last_sync_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_channel_connections_provider
  ON public.channel_connections (provider_key);

CREATE TABLE IF NOT EXISTS public.channel_unit_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.channel_connections(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  external_listing_id text NOT NULL,
  external_room_type_id text,
  external_rate_plan_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, unit_id),
  UNIQUE (connection_id, external_listing_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_unit_mappings_unit
  ON public.channel_unit_mappings (unit_id);

CREATE TABLE IF NOT EXISTS public.channel_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid REFERENCES public.channel_connections(id) ON DELETE SET NULL,
  feed_id uuid REFERENCES public.unit_ota_feeds(id) ON DELETE SET NULL,
  unit_id uuid REFERENCES public.units(id) ON DELETE SET NULL,
  provider_key text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound', 'internal')),
  operation text NOT NULL,
  status text NOT NULL CHECK (status IN ('success', 'error', 'partial', 'skipped')),
  message text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_channel_sync_logs_created
  ON public.channel_sync_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_sync_logs_feed
  ON public.channel_sync_logs (feed_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_sync_logs_connection
  ON public.channel_sync_logs (connection_id, created_at DESC);
