-- Force every unit to draft (hidden from guests).
UPDATE units
SET status = 'draft', updated_at = now()
WHERE status <> 'draft';
