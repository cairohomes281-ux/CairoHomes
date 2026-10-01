-- 115_remove_housekeeping_utilities.sql
-- Housekeeping (cleaning tasks, service orders, housekeeping fees) and utilities
-- (unit utilities cost, reservation utilities charges, campus utilities recurring
-- charge) are no longer part of the product.

DROP TABLE IF EXISTS public.housekeeping_inspections CASCADE;
DROP TABLE IF EXISTS public.housekeeping_tasks CASCADE;
DROP TABLE IF EXISTS public.housekeeping_service_orders CASCADE;

ALTER TABLE public.maintenance_tickets
  DROP COLUMN IF EXISTS housekeeping_task_id;

ALTER TABLE public.reservations
  DROP COLUMN IF EXISTS housekeeping_fees,
  DROP COLUMN IF EXISTS utilities_amount,
  DROP COLUMN IF EXISTS utilities_cost_override;

ALTER TABLE public.units
  DROP COLUMN IF EXISTS cleaning_fee_egp,
  DROP COLUMN IF EXISTS utilities_cost;

DELETE FROM public.financial_recurring_charges WHERE kind = 'utilities';

UPDATE public.staff_users
SET is_active = 0, updated_at = now()
WHERE role IN ('housekeeping', 'housekeeping_supervisor');
