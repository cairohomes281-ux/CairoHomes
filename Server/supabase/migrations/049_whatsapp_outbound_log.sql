-- Outbound WhatsApp send log (dedupe + audit).

CREATE TABLE IF NOT EXISTS public.whatsapp_outbound_log (
  id serial PRIMARY KEY,
  kind varchar(40) NOT NULL,
  entity_type varchar(40) NOT NULL,
  entity_id text NOT NULL,
  phone text,
  status varchar(20) NOT NULL DEFAULT 'sent',
  error_message text,
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_outbound_log_kind_entity_uidx UNIQUE (kind, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS whatsapp_outbound_log_created_idx
  ON public.whatsapp_outbound_log (created_at DESC);
