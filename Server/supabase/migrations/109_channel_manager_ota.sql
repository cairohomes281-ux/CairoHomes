-- Channel Manager OTA: reservation channel finance + messaging inbox

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS channel_commission_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS channel_commission_pct numeric(8,4),
  ADD COLUMN IF NOT EXISTS external_reservation_id text,
  ADD COLUMN IF NOT EXISTS channel_connection_id uuid REFERENCES public.channel_connections(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_external_channel
  ON public.reservations (channel_connection_id, external_reservation_id)
  WHERE external_reservation_id IS NOT NULL AND channel_connection_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reservations_booking_source
  ON public.reservations (lower(trim(booking_source)));

-- Normalize legacy website casing for reporting
UPDATE public.reservations
SET booking_source = 'Website'
WHERE booking_id IS NOT NULL
  AND (booking_source IS NULL OR lower(trim(booking_source)) IN ('website', 'web'));

CREATE TABLE IF NOT EXISTS public.channel_message_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.channel_connections(id) ON DELETE CASCADE,
  external_thread_id text NOT NULL,
  unit_id uuid REFERENCES public.units(id) ON DELETE SET NULL,
  reservation_id integer REFERENCES public.reservations(id) ON DELETE SET NULL,
  guest_name text,
  guest_email text,
  subject text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'archived')),
  last_message_at timestamptz,
  unread_count integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, external_thread_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_message_threads_last
  ON public.channel_message_threads (last_message_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS public.channel_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.channel_message_threads(id) ON DELETE CASCADE,
  external_message_id text,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body text NOT NULL,
  sender_name text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thread_id, external_message_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_messages_thread
  ON public.channel_messages (thread_id, sent_at ASC);
