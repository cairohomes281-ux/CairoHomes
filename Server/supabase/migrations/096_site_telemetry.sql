-- Guest-site errors, funnel events, and page timings for the web developer PMS.

CREATE TABLE IF NOT EXISTS public.site_guest_errors (
  id bigserial PRIMARY KEY,
  fingerprint text NOT NULL,
  error_type text NOT NULL,
  message text NOT NULL,
  path text,
  status_code integer,
  session_id text,
  user_agent text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_guest_errors_created
  ON public.site_guest_errors (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_guest_errors_fp
  ON public.site_guest_errors (fingerprint, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_guest_errors_type
  ON public.site_guest_errors (error_type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.site_guest_events (
  id bigserial PRIMARY KEY,
  event text NOT NULL,
  path text,
  duration_ms integer,
  session_id text,
  unit_slug text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_guest_events_created
  ON public.site_guest_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_guest_events_event
  ON public.site_guest_events (event, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_guest_events_session
  ON public.site_guest_events (session_id, created_at);

ALTER TABLE public.site_guest_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_guest_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.site_guest_errors FROM PUBLIC;
REVOKE ALL ON TABLE public.site_guest_events FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.site_guest_errors FROM anon';
    EXECUTE 'REVOKE ALL ON TABLE public.site_guest_events FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.site_guest_errors FROM authenticated';
    EXECUTE 'REVOKE ALL ON TABLE public.site_guest_events FROM authenticated';
  END IF;
END $$;
