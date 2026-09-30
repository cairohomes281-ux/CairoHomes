-- Allow deleting staff accounts: nullable FKs to staff_users currently use
-- NO ACTION, so Postgres rejects DELETE when the user is assigned to ops,
-- housekeeping, insurance refunds, or financial records.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT
      n.nspname AS schema_name,
      t.relname AS table_name,
      a.attname AS column_name,
      c.conname AS constraint_name
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = c.conkey[1]
    JOIN pg_class rt ON rt.oid = c.confrelid
    JOIN pg_namespace rn ON rn.oid = rt.relnamespace
    WHERE c.contype = 'f'
      AND rn.nspname = 'public'
      AND rt.relname = 'staff_users'
      AND n.nspname = 'public'
      AND array_length(c.conkey, 1) = 1
      AND c.confdeltype IN ('a', 'r')
      AND a.attnotnull = false
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I DROP CONSTRAINT %I',
      r.schema_name, r.table_name, r.constraint_name
    );
    EXECUTE format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.staff_users(id) ON DELETE SET NULL',
      r.schema_name, r.table_name, r.constraint_name, r.column_name
    );
  END LOOP;
END $$;
