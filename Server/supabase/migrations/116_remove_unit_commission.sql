-- 116_remove_unit_commission.sql
-- Units no longer carry an owner commission: owners receive the full rental
-- amount (less any broker fee), and guests are no longer charged a tenant markup.

ALTER TABLE public.units
  DROP COLUMN IF EXISTS commission_mode,
  DROP COLUMN IF EXISTS company_commission_pct,
  DROP COLUMN IF EXISTS company_commission_owner_pct,
  DROP COLUMN IF EXISTS commission_tenant_pct;
