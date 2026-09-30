const { query } = require('../config/db');

async function ensureStaffTaskTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS public.staff_tasks (
      id serial PRIMARY KEY,
      assignee_id integer NOT NULL REFERENCES public.staff_users(id),
      created_by integer NOT NULL REFERENCES public.staff_users(id),
      title varchar(255) NOT NULL,
      description text,
      deadline date NOT NULL,
      created_at timestamptz DEFAULT now()
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS staff_tasks_assignee_idx
      ON public.staff_tasks (assignee_id, deadline)
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS staff_tasks_created_by_idx
      ON public.staff_tasks (created_by)
  `);
  await query(`
    ALTER TABLE public.staff_tasks
      ADD COLUMN IF NOT EXISTS completed_at timestamptz
  `);
  await query(`
    ALTER TABLE public.staff_tasks
      ADD COLUMN IF NOT EXISTS completed_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS public.staff_user_managers (
      staff_user_id integer NOT NULL REFERENCES public.staff_users(id) ON DELETE CASCADE,
      manager_id integer NOT NULL REFERENCES public.staff_users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (staff_user_id, manager_id),
      CONSTRAINT staff_user_managers_not_self CHECK (staff_user_id <> manager_id)
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS staff_user_managers_manager_id_idx
      ON public.staff_user_managers (manager_id)
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS public.staff_task_comments (
      id serial PRIMARY KEY,
      task_id integer NOT NULL REFERENCES public.staff_tasks(id) ON DELETE CASCADE,
      author_id integer NOT NULL REFERENCES public.staff_users(id) ON DELETE CASCADE,
      body text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT staff_task_comments_body_nonempty CHECK (btrim(body) <> '')
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS staff_task_comments_task_id_idx
      ON public.staff_task_comments (task_id, created_at ASC)
  `);
}

async function staffTaskTablesReady() {
  try {
    const { rows } = await query(
      `SELECT
         to_regclass('public.staff_tasks') IS NOT NULL AS staff_tasks,
         to_regclass('public.staff_user_managers') IS NOT NULL AS staff_user_managers`
    );
    return {
      staff_tasks: Boolean(rows[0]?.staff_tasks),
      staff_user_managers: Boolean(rows[0]?.staff_user_managers),
      ready: Boolean(rows[0]?.staff_tasks && rows[0]?.staff_user_managers),
    };
  } catch {
    return { staff_tasks: false, staff_user_managers: false, ready: false };
  }
}

module.exports = { ensureStaffTaskTables, staffTaskTablesReady };
