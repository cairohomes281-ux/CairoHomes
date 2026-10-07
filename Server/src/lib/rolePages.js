/**
 * PMS page access per role.
 *
 * Every staff role has default pages (mirrors Client/src/admin/utils/permissions.js PAGE_ACCESS).
 * The CEO can override the page list of a built-in role (staff_role_pages) or give a custom
 * role any pages (staff_roles.pages). When a role is given a page it does not have by default,
 * requests to that page's API act as the page's owner role, so existing role checks keep working.
 */

const STAFF_HR_TABS = ['requests', 'payslip'];

const RESERVATIONS_WEB = ['tasks', 'reservations', 'schedule', 'calendar_sync', 'website_bookings', 'units', 'projects', ...STAFF_HR_TABS];
const HR_PAGES = ['users', 'payroll', 'deductions', 'requests', 'holiday_access', 'job_offers', 'attendance', 'payslip', 'tasks', 'reservations'];

const DEFAULT_ROLE_PAGES = {
  reservations: RESERVATIONS_WEB,
  reservations_web: RESERVATIONS_WEB,
  reservations_manual: ['tasks', 'reservations', 'schedule', 'calendar_sync', 'units', 'projects', ...STAFF_HR_TABS],
  reservations_manager: ['tasks', 'reservations', 'schedule', 'calendar_sync', 'performance', 'reservation_audit', 'units', 'projects', ...STAFF_HR_TABS],
  unit_acquisition_agent: ['tasks', 'units', 'reservations', 'schedule', ...STAFF_HR_TABS],
  unit_acquisition_manager: ['tasks', 'units', 'reservations', 'schedule', 'acquisition', 'owner_statement', 'owners', ...STAFF_HR_TABS],
  operations: ['tasks', 'operations', 'ops_checkins', 'reservations', 'schedule', ...STAFF_HR_TABS],
  operations_supervisor: ['tasks', 'operations', 'ops_checkins', 'ops_comments', 'reservations', 'schedule', ...STAFF_HR_TABS],
  resale: ['tasks', ...STAFF_HR_TABS],
  resale_manager: ['tasks', ...STAFF_HR_TABS],
  finance: ['tasks', 'financial_system', 'units', 'reservations', 'schedule', ...STAFF_HR_TABS],
  finance_manager: ['tasks', 'financial_system', 'finance_audit', 'units', 'reservations', 'schedule', ...STAFF_HR_TABS],
  hr: HR_PAGES,
  hr_supervisor: HR_PAGES,
  owners_relations: ['units', 'reservations', 'owner_statement', 'owner_blocks', 'tasks', ...STAFF_HR_TABS],
  marketing_pr: ['tasks', 'reservations', 'units', 'schedule', ...STAFF_HR_TABS],
  web_developer: ['tasks', ...STAFF_HR_TABS],
};

const GET = ['GET'];

/**
 * owner: the role whose permissions a granted page acts with (null = every role has it).
 * api: path prefixes under /api the page uses; `methods` limits a prefix to reads.
 */
const PAGE_RULES = {
  dashboard: { owner: 'admin', api: ['/pms/dashboard'] },
  tasks: { owner: null, api: [] },
  units: { owner: 'reservations_manager', api: ['/pms/units'] },
  // Follows "units" for every role except the CEO.
  units_long_term: { owner: null, api: [] },
  projects: { owner: 'reservations_manager', api: ['/projects'] },
  acquisition: { owner: 'unit_acquisition_manager', api: ['/pms/acquisition-leads'] },
  owner_statement: {
    owner: 'unit_acquisition_manager',
    api: ['/pms/reports/owner-statement', { prefix: '/pms/owner/units', methods: GET }, { prefix: '/pms/units', methods: GET }],
  },
  owner_blocks: { owner: 'owners_relations', api: ['/pms/owner/blocks', { prefix: '/pms/owner/units', methods: GET }] },
  owners: { owner: 'unit_acquisition_manager', api: ['/pms/users/owners', '/pms/users'] },
  reservations: {
    owner: 'reservations_manager',
    api: ['/pms/reservations', '/pms/payments', '/pms/id-documents', { prefix: '/pms/users/sales', methods: GET }, { prefix: '/pms/units', methods: GET }],
  },
  website_bookings: { owner: 'reservations_web', api: ['/pms/website-bookings'] },
  schedule: {
    owner: 'reservations_manager',
    api: [
      '/pms/reservations/schedule',
      '/pms/blocked-dates',
      '/pms/calendar-blocks',
      '/pms/daily-prices',
      { prefix: '/pms/reservations', methods: GET },
      { prefix: '/pms/users/sales', methods: GET },
      { prefix: '/pms/units', methods: GET },
    ],
  },
  calendar_sync: { owner: 'reservations_manager', api: ['/pms/channel-manager', '/pms/ota-calendar'] },
  performance: { owner: 'reservations_manager', api: ['/pms/reservation-targets', '/pms/reservations-performance'] },
  reservation_audit: { owner: 'reservations_manager', api: ['/pms/reservation-audit'] },
  operations: { owner: 'operations_supervisor', api: ['/pms/ops'] },
  ops_checkins: { owner: 'operations_supervisor', api: ['/pms/ops/checkins-today', '/pms/ops/checkouts-today', '/pms/ops/checkins-history', '/pms/ops/agents'] },
  ops_comments: { owner: 'operations_supervisor', api: ['/pms/ops/checkin-comments'] },
  financial_system: {
    owner: 'finance_manager',
    api: [
      '/pms/financial-system',
      '/pms/petty-cash',
      '/pms/owner/payout-requests',
      { prefix: '/pms/users/owners', methods: GET },
      { prefix: '/pms/reservations', methods: GET },
      { prefix: '/pms/units', methods: GET },
    ],
  },
  finance_audit: { owner: 'finance_manager', api: ['/pms/finance-audit'] },
  promo_codes: { owner: 'admin', api: ['/pms/promo-codes', '/pms/site-popup', { prefix: '/pms/units', methods: GET }] },
  users: { owner: 'hr_supervisor', api: ['/pms/users', { prefix: '/pms/staff-roles', methods: GET }] },
  attendance: { owner: 'hr_supervisor', api: ['/pms/hr/attendance'] },
  requests: { owner: null, api: [] },
  holiday_access: { owner: 'hr_supervisor', api: ['/pms/hr/holiday-access'] },
  deductions: {
    owner: 'hr_supervisor',
    api: ['/pms/hr/salary-bonuses', '/pms/hr/salary-deductions', { prefix: '/pms/users', methods: GET }],
  },
  payslip: { owner: null, api: [] },
  payroll: { owner: 'hr_supervisor', api: ['/pms/hr/payroll'] },
  job_offers: { owner: 'hr_supervisor', api: ['/recruitment'] },
};

const PAGE_KEYS = Object.keys(PAGE_RULES);

/** Roles whose pages cannot be edited (CEO sees everything; owners use the owner portal). */
const FIXED_PAGE_ROLES = new Set(['admin', 'owner']);

function defaultPagesForRole(role) {
  return DEFAULT_ROLE_PAGES[role] ? [...DEFAULT_ROLE_PAGES[role]] : [];
}

function cleanPages(raw) {
  if (!Array.isArray(raw)) return null;
  return [...new Set(raw.map((p) => String(p || '').trim()))].filter((p) => PAGE_RULES[p]);
}

/**
 * Pages a staff user can open, or null for roles without a page list (CEO / owner).
 * `user` carries role, custom_role_id, custom_role_pages and role_pages (built-in override).
 */
function pageAccessFor(user) {
  if (!user || user.role === 'owner') return null;
  if (user.custom_role_id && Array.isArray(user.custom_role_pages)) {
    return cleanPages(user.custom_role_pages);
  }
  if (user.role === 'admin') return null;
  if (Array.isArray(user.role_pages)) return cleanPages(user.role_pages);
  return defaultPagesForRole(user.role);
}

/** Pages granted beyond the role's defaults, mapped to the role they act as. */
function actingPagesFor(user, pages = pageAccessFor(user)) {
  if (!Array.isArray(pages) || FIXED_PAGE_ROLES.has(user.role)) return {};
  const defaults = new Set(defaultPagesForRole(user.role));
  const out = {};
  for (const page of pages) {
    const owner = PAGE_RULES[page]?.owner;
    if (!defaults.has(page) && owner && owner !== user.role) out[page] = owner;
  }
  return out;
}

function matchLength(rule, method, apiPath) {
  const prefix = typeof rule === 'string' ? rule : rule.prefix;
  const methods = typeof rule === 'string' ? null : rule.methods;
  if (methods && !methods.includes(method)) return -1;
  if (apiPath === prefix || apiPath.startsWith(`${prefix}/`)) return prefix.length;
  return -1;
}

/**
 * Role a request should act as, or null to keep the user's own role.
 * Only the most specific matching page prefix counts; a page the role already has by
 * default always keeps the user's own role.
 */
function actingRoleForRequest(user, method, apiPath) {
  if (!user || FIXED_PAGE_ROLES.has(user.role)) return null;
  const acting = user.acting_pages || actingPagesFor(user);
  if (!Object.keys(acting).length) return null;

  let best = -1;
  let matched = [];
  for (const [page, rule] of Object.entries(PAGE_RULES)) {
    let len = -1;
    for (const r of rule.api) len = Math.max(len, matchLength(r, method, apiPath));
    if (len < 0) continue;
    if (len > best) {
      best = len;
      matched = [page];
    } else if (len === best) {
      matched.push(page);
    }
  }
  if (!matched.length) return null;
  const defaults = new Set(defaultPagesForRole(user.role));
  if (matched.some((p) => defaults.has(p))) return null;
  for (const page of matched) {
    if (acting[page]) return acting[page];
  }
  return null;
}

module.exports = {
  DEFAULT_ROLE_PAGES,
  PAGE_RULES,
  PAGE_KEYS,
  FIXED_PAGE_ROLES,
  defaultPagesForRole,
  cleanPages,
  pageAccessFor,
  actingPagesFor,
  actingRoleForRequest,
};
