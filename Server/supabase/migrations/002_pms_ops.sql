-- 002_pms_ops.sql
-- Staff / ops tables (staff_users replaces PMS `users` to avoid auth.users clash)

CREATE TABLE IF NOT EXISTS public.staff_users (
  id serial PRIMARY KEY,
  username varchar(255) UNIQUE NOT NULL,
  password_hash varchar(255) NOT NULL,
  email varchar(255) UNIQUE,
  full_name varchar(255) NOT NULL,
  role varchar(50) NOT NULL
    CHECK (role = ANY (ARRAY[
      'admin','finance','operation_manager','acquisition_reservation',
      'hr','owner','broker','owner_experience','sales'
    ])),
  sales_commission_pct real DEFAULT 0,
  operation_specialist_pct real DEFAULT 0,
  operation_manager_pct real DEFAULT 0,
  reservation_manager_pct real DEFAULT 0,
  petty_cash_location varchar(100),
  is_active integer DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reservations (
  id serial PRIMARY KEY,
  unit_id uuid NOT NULL REFERENCES public.units(id),
  booking_id uuid REFERENCES public.bookings(id),
  guest_name varchar(255) NOT NULL,
  guest_email varchar(255),
  guest_phone varchar(100),
  guest_nationality varchar(100),
  check_in date NOT NULL,
  check_out date NOT NULL,
  nights integer NOT NULL,
  total_amount real NOT NULL,
  amount_paid real DEFAULT 0,
  payment_status varchar(50) DEFAULT 'pending'
    CHECK (payment_status = ANY (ARRAY['pending','partial','paid'])),
  booking_source varchar(255),
  sales_person_id integer REFERENCES public.staff_users(id),
  is_owner_reservation integer DEFAULT 0,
  transfer_proof_path text,
  transfer_proof_name text,
  status varchar(50) DEFAULT 'confirmed'
    CHECK (status = ANY (ARRAY['confirmed','cancelled','checked_in','checked_out','pending'])),
  notes text,
  hold_expires_at timestamptz,
  created_by integer NOT NULL REFERENCES public.staff_users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payments (
  id serial PRIMARY KEY,
  reservation_id integer REFERENCES public.reservations(id),
  booking_id uuid REFERENCES public.bookings(id),
  amount real NOT NULL,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_method varchar(50) NOT NULL
    CHECK (payment_method = ANY (ARRAY[
      'cash','bank_transfer','credit_card','online','paymob_card','instapay'
    ])),
  reference_number varchar(255),
  notes text,
  document_path text,
  document_name varchar(255),
  is_approved integer DEFAULT 0,
  approved_by integer REFERENCES public.staff_users(id),
  approved_at timestamptz,
  status varchar(50) DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending','successful','failed','cancelled'])),
  transaction_reference text,
  paid_at timestamptz,
  created_by integer REFERENCES public.staff_users(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.expenses (
  id serial PRIMARY KEY,
  unit_id uuid NOT NULL REFERENCES public.units(id),
  description text NOT NULL,
  amount real NOT NULL,
  paid_by varchar(50) NOT NULL CHECK (paid_by = ANY (ARRAY['company','owner','tenant'])),
  expense_date date NOT NULL,
  notes text,
  created_by integer NOT NULL REFERENCES public.staff_users(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.commissions (
  id serial PRIMARY KEY,
  reservation_id integer NOT NULL REFERENCES public.reservations(id),
  user_id integer NOT NULL REFERENCES public.staff_users(id),
  commission_type varchar(100) NOT NULL
    CHECK (commission_type = ANY (ARRAY[
      'sales','operation_specialist','operation_manager','reservation_manager'
    ])),
  percentage real NOT NULL,
  amount real NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id serial PRIMARY KEY,
  user_id integer REFERENCES public.staff_users(id),
  type varchar(100) NOT NULL,
  title varchar(255) NOT NULL,
  message text NOT NULL,
  is_read integer DEFAULT 0,
  entity_type varchar(100),
  entity_id integer,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.documents (
  id serial PRIMARY KEY,
  entity_type varchar(100) NOT NULL,
  entity_id text NOT NULL,
  filename text NOT NULL,
  original_name varchar(255) NOT NULL,
  file_size integer,
  mime_type varchar(100),
  cloudinary_url text,
  created_by integer NOT NULL REFERENCES public.staff_users(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.employees (
  id serial PRIMARY KEY,
  name varchar(255) NOT NULL,
  phone varchar(100),
  salary_system varchar(50) NOT NULL CHECK (salary_system = ANY (ARRAY['full','split'])),
  base_salary real NOT NULL,
  performance_pct real DEFAULT 40,
  is_active integer DEFAULT 1,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.salary_deductions (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL REFERENCES public.employees(id),
  amount real NOT NULL,
  reason varchar(255) NOT NULL,
  deduction_date date NOT NULL,
  system_type varchar(50) NOT NULL CHECK (system_type = ANY (ARRAY['delay','performance'])),
  created_by integer REFERENCES public.staff_users(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tasks (
  id serial PRIMARY KEY,
  title varchar(255) NOT NULL,
  description text,
  priority varchar(50) NOT NULL CHECK (priority = ANY (ARRAY['low','medium','high','urgent'])),
  status varchar(50) NOT NULL CHECK (status = ANY (ARRAY['not_started','in_progress','done'])),
  assigned_to integer REFERENCES public.staff_users(id),
  created_by integer NOT NULL REFERENCES public.staff_users(id),
  due_date date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.owner_units (
  id serial PRIMARY KEY,
  owner_id integer NOT NULL REFERENCES public.staff_users(id),
  unit_id uuid NOT NULL REFERENCES public.units(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE (owner_id, unit_id)
);

CREATE TABLE IF NOT EXISTS public.petty_cash (
  id serial PRIMARY KEY,
  location varchar(100) NOT NULL,
  description text NOT NULL,
  amount real NOT NULL,
  entry_type varchar(20) NOT NULL CHECK (entry_type = ANY (ARRAY['in','out'])),
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  linked_expense_id integer REFERENCES public.expenses(id),
  linked_reservation_id integer REFERENCES public.reservations(id),
  created_by integer NOT NULL REFERENCES public.staff_users(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.petty_cash_settings (
  id serial PRIMARY KEY,
  location varchar(100) UNIQUE NOT NULL,
  opening_balance real NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cash_ledger (
  id serial PRIMARY KEY,
  entry_type varchar(20) NOT NULL CHECK (entry_type = ANY (ARRAY['in','out'])),
  category varchar(100),
  description text NOT NULL,
  amount real NOT NULL,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  reference text,
  created_by integer REFERENCES public.staff_users(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id serial PRIMARY KEY,
  user_id integer REFERENCES public.staff_users(id),
  action varchar(100) NOT NULL,
  entity_type varchar(100),
  entity_id text,
  details jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sales_notifications (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES public.staff_users(id),
  title varchar(255) NOT NULL,
  message text NOT NULL,
  is_read integer DEFAULT 0,
  meta jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
