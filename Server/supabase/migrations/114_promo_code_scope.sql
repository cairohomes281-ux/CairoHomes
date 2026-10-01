-- 114_promo_code_scope.sql
-- Optionally limit a promo code to destinations (units.area), projects
-- (units.project / units.compound) or specific units. Empty lists = valid everywhere;
-- otherwise the unit must match at least one list.

ALTER TABLE public.promo_codes
  ADD COLUMN IF NOT EXISTS scope_destinations text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS scope_projects text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS scope_unit_ids uuid[] NOT NULL DEFAULT '{}';
