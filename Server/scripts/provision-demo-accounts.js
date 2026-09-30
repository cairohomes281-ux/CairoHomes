/**
 * Provision demo staff accounts for every role except admin (and owner portal).
 *
 * Usage: node scripts/provision-demo-accounts.js
 *
 * Shared password: 123
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const bcrypt = require('bcryptjs');
const { query, pool } = require('../src/config/db');
const { generateUniqueStaffCode } = require('../src/lib/staffIdentity');

const DEMO_PASSWORD = '123';

/** All staff roles except admin / owner. */
const ACCOUNTS = [
  {
    role: 'reservations_manager',
    username: 'demo.reservations.manager',
    email: 'demo.reservations.manager@cairohomes.com',
    full_name: 'Demo Reservations Manager',
  },
  {
    role: 'reservations_web',
    username: 'demo.reservations.web',
    email: 'demo.reservations.web@cairohomes.com',
    full_name: 'Demo Website Reservations',
  },
  {
    role: 'reservations_manual',
    username: 'demo.reservations.manual',
    email: 'demo.reservations.manual@cairohomes.com',
    full_name: 'Demo Manual Reservations',
  },
  {
    role: 'reservations',
    username: 'demo.reservations',
    email: 'demo.reservations@cairohomes.com',
    full_name: 'Demo Reservations (legacy)',
  },
  {
    role: 'unit_acquisition_manager',
    username: 'demo.acquisition.manager',
    email: 'demo.acquisition.manager@cairohomes.com',
    full_name: 'Demo Unit Acquisition Manager',
  },
  {
    role: 'unit_acquisition_agent',
    username: 'demo.acquisition',
    email: 'demo.acquisition@cairohomes.com',
    full_name: 'Demo Unit Acquisition Agent',
  },
  {
    role: 'operations_supervisor',
    username: 'demo.ops.supervisor',
    email: 'demo.ops.supervisor@cairohomes.com',
    full_name: 'Demo Operations Supervisor',
  },
  {
    role: 'operations',
    username: 'demo.ops',
    email: 'demo.ops@cairohomes.com',
    full_name: 'Demo Operations',
  },
  {
    role: 'resale_manager',
    username: 'demo.resale.manager',
    email: 'demo.resale.manager@cairohomes.com',
    full_name: 'Demo Resale Manager',
  },
  {
    role: 'resale',
    username: 'demo.resale',
    email: 'demo.resale@cairohomes.com',
    full_name: 'Demo Resale',
  },
  {
    role: 'finance_manager',
    username: 'demo.finance.manager',
    email: 'demo.finance.manager@cairohomes.com',
    full_name: 'Demo Financial Manager',
  },
  {
    role: 'finance',
    username: 'demo.finance',
    email: 'demo.finance@cairohomes.com',
    full_name: 'Demo Finance',
  },
  {
    role: 'hr_supervisor',
    username: 'demo.hr.manager',
    email: 'demo.hr.manager@cairohomes.com',
    full_name: 'Demo HR Manager',
  },
  {
    role: 'hr',
    username: 'demo.hr',
    email: 'demo.hr@cairohomes.com',
    full_name: 'Demo HR',
  },
  {
    role: 'owners_relations',
    username: 'demo.owners',
    email: 'demo.owners@cairohomes.com',
    full_name: 'Demo Owner Experience',
  },
  {
    role: 'marketing_pr',
    username: 'demo.marketing',
    email: 'demo.marketing@cairohomes.com',
    full_name: 'Demo Marketing and PR',
  },
  {
    role: 'web_developer',
    username: 'demo.web',
    email: 'demo.web@cairohomes.com',
    full_name: 'Demo Web Developer',
  },
];

/** Agent → manager role for line-manager linking after create. */
const MANAGER_OF = {
  reservations_web: 'reservations_manager',
  reservations_manual: 'reservations_manager',
  reservations: 'reservations_manager',
  unit_acquisition_agent: 'unit_acquisition_manager',
  operations: 'operations_supervisor',
  resale: 'resale_manager',
  finance: 'finance_manager',
  hr: 'hr_supervisor',
};

async function ensureAccount(acc, passwordHash) {
  const { rows: existing } = await query(
    `SELECT id, username, role, staff_code, is_active
     FROM staff_users
     WHERE lower(username) = lower($1) OR lower(email) = lower($2)
     LIMIT 1`,
    [acc.username, acc.email]
  );

  if (existing[0]) {
    const row = existing[0];
    await query(
      `UPDATE staff_users SET
         role = $2,
         full_name = $3,
         email = $4,
         username = $5,
         is_active = 1,
         password_hash = $6,
         is_first_login = 0,
         base_salary = COALESCE(NULLIF(base_salary, 0), 10000),
         updated_at = now()
       WHERE id = $1`,
      [row.id, acc.role, acc.full_name, acc.email, acc.username, passwordHash]
    );
    return { action: 'updated', id: row.id, staff_code: row.staff_code, username: acc.username };
  }

  const staffCode = await generateUniqueStaffCode(acc.role);
  const { rows } = await query(
    `INSERT INTO staff_users (
       username, email, full_name, role, password_hash,
       staff_code, is_active, is_first_login, sales_commission_pct,
       base_salary, salary_change_status, leave_casual_days, leave_annual_days,
       created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, 1, 0, 0,
       10000, 'none', 3, 15,
       now(), now()
     )
     RETURNING id, staff_code, username`,
    [acc.username, acc.email, acc.full_name, acc.role, passwordHash, staffCode]
  );
  return { action: 'created', id: rows[0].id, staff_code: rows[0].staff_code, username: rows[0].username };
}

async function linkManagers(resultsByRole) {
  for (const [agentRole, managerRole] of Object.entries(MANAGER_OF)) {
    const agent = resultsByRole[agentRole];
    const manager = resultsByRole[managerRole];
    if (!agent || !manager) continue;
    await query(`UPDATE staff_users SET manager_id = $2, updated_at = now() WHERE id = $1`, [
      agent.id,
      manager.id,
    ]);
    await query(`DELETE FROM staff_user_managers WHERE staff_user_id = $1`, [agent.id]);
    await query(
      `INSERT INTO staff_user_managers (staff_user_id, manager_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [agent.id, manager.id]
    );
  }
}

async function main() {
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const results = [];
  const byRole = {};

  for (const acc of ACCOUNTS) {
    const result = await ensureAccount(acc, hash);
    const row = { ...result, role: acc.role, email: acc.email };
    results.push(row);
    byRole[acc.role] = row;
    console.log(
      `[${result.action}] ${acc.role.padEnd(28)} ${acc.username.padEnd(32)} id=${result.id}`
    );
  }

  await linkManagers(byRole);

  console.log('');
  console.log('Demo password (all accounts):', DEMO_PASSWORD);
  console.log('Sign in at /admin (or your PMS login) with username or email.');
  console.log('');
  console.log('username'.padEnd(32), 'role');
  console.log('-'.repeat(60));
  for (const r of results) {
    console.log(r.username.padEnd(32), r.role);
  }

  await pool.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
