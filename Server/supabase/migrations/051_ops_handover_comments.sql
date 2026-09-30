-- Ops agent handover comments (reviewed by operations supervisor).
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS ops_handover_comment text,
  ADD COLUMN IF NOT EXISTS ops_handover_comment_at timestamptz,
  ADD COLUMN IF NOT EXISTS ops_handover_comment_by integer REFERENCES public.staff_users(id),
  ADD COLUMN IF NOT EXISTS ops_comment_reviewed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ops_comment_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS ops_comment_reviewed_by integer REFERENCES public.staff_users(id);

CREATE INDEX IF NOT EXISTS idx_reservations_ops_handover_comment
  ON public.reservations (ops_handover_comment_at DESC NULLS LAST)
  WHERE ops_handover_comment IS NOT NULL AND btrim(ops_handover_comment) <> '';
