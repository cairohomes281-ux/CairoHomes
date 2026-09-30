export const ROLES = {
  ADMIN: 'admin',
  RESERVATIONS: 'reservations',
  RESERVATIONS_WEB: 'reservations_web',
  RESERVATIONS_MANUAL: 'reservations_manual',
  RESERVATIONS_MANAGER: 'reservations_manager',
  UNIT_ACQUISITION_AGENT: 'unit_acquisition_agent',
  UNIT_ACQUISITION_MANAGER: 'unit_acquisition_manager',
  OPERATIONS: 'operations',
  OPERATIONS_SUPERVISOR: 'operations_supervisor',
  HOUSEKEEPING: 'housekeeping',
  HOUSEKEEPING_SUPERVISOR: 'housekeeping_supervisor',
  RESALE: 'resale',
  RESALE_MANAGER: 'resale_manager',
  FINANCE: 'finance',
  FINANCE_MANAGER: 'finance_manager',
  HR: 'hr',
  HR_SUPERVISOR: 'hr_supervisor',
  OWNERS_RELATIONS: 'owners_relations',
  OWNER: 'owner',
  MARKETING_PR: 'marketing_pr',
  WEB_DEVELOPER: 'web_developer',
};

const RESERVATIONS_TEAM = new Set([
  'reservations',
  'reservations_web',
  'reservations_manual',
]);

/** Self-service HR pages available to most staff roles ("HR tabs"). */
const STAFF_HR_TABS = [
  'requests',
  'payslip',
  'profile',
];

const RESERVATIONS_PAGE_ACCESS = new Set([
  'tasks',
  'reservations',
  'schedule',
  ...STAFF_HR_TABS,
]);

const RESERVATIONS_MANUAL_PAGE_ACCESS = new Set([
  'tasks',
  'reservations',
  'schedule',
  'calendar_sync',
  'units',
  'projects',
  ...STAFF_HR_TABS,
]);

const RESERVATIONS_WEB_PAGE_ACCESS = new Set([
  'tasks',
  'reservations',
  'schedule',
  'calendar_sync',
  'website_bookings',
  'units',
  'projects',
  ...STAFF_HR_TABS,
]);

const RESALE_PAGE_ACCESS = new Set(['tasks', ...STAFF_HR_TABS]);

const RESALE_MANAGER_PAGE_ACCESS = new Set(['tasks', ...STAFF_HR_TABS]);

const FINANCE_PAGE_ACCESS = new Set([
  'tasks',
  'financial_system',
  'units',
  'reservations',
  'schedule',
  ...STAFF_HR_TABS,
]);

const FINANCE_MANAGER_PAGE_ACCESS = new Set([
  'tasks',
  'financial_system',
  'finance_audit',
  'units',
  'reservations',
  'schedule',
  ...STAFF_HR_TABS,
]);

const RESERVATIONS_MANAGER_PAGE_ACCESS = new Set([
  'tasks',
  'reservations',
  'schedule',
  'calendar_sync',
  'performance',
  'reservation_audit',
  'units',
  'projects',
  ...STAFF_HR_TABS,
]);

const UNIT_ACQUISITION_AGENT_PAGE_ACCESS = new Set([
  'tasks',
  'units',
  'reservations',
  'schedule',
  ...STAFF_HR_TABS,
]);

const UNIT_ACQUISITION_MANAGER_PAGE_ACCESS = new Set([
  'tasks',
  'units',
  'reservations',
  'schedule',
  'acquisition',
  'owner_statement',
  'owners',
  ...STAFF_HR_TABS,
]);

const OPERATIONS_PAGE_ACCESS = new Set([
  'tasks',
  'operations',
  'ops_checkins',
  'hk_today',
  'reservations',
  'schedule',
  ...STAFF_HR_TABS,
]);

const OPERATIONS_SUPERVISOR_PAGE_ACCESS = new Set([
  'tasks',
  'operations',
  'ops_checkins',
  'ops_comments',
  'hk_today',
  'reservations',
  'schedule',
  ...STAFF_HR_TABS,
]);

const HOUSEKEEPING_PAGE_ACCESS = new Set(['tasks', 'housekeeping', 'hk_today', ...STAFF_HR_TABS]);

const HOUSEKEEPING_SUPERVISOR_PAGE_ACCESS = new Set([
  'tasks',
  'housekeeping',
  'hk_today',
  ...STAFF_HR_TABS,
]);

const MARKETING_PR_PAGE_ACCESS = new Set([
  'tasks',
  'reservations',
  'units',
  'schedule',
  ...STAFF_HR_TABS,
]);

const WEB_DEVELOPER_PAGE_ACCESS = new Set(['tasks', ...STAFF_HR_TABS]);

const RESERVATIONS_PERMISSIONS = [
  'dashboard:read',
  'units:read',
  'units:write',
  'reservations:read',
  'reservations:write',
  'reservations:confirm',
  'reservations:delete',
  'schedule:read',
  'housekeeping:read',
  'housekeeping:write',
  'notifications:read',
  'documents:read',
  'documents:write',
];

const RESERVATIONS_MANUAL_PERMISSIONS = [
  'units:read',
  'units:write',
  'projects:read',
  'projects:write',
  'calendar_sync:write',
  'reservations:read',
  'reservations:write',
  'reservations:confirm',
  'reservations:delete',
  'schedule:read',
  'notifications:read',
  'documents:read',
  'documents:write',
];

const RESERVATIONS_WEB_PERMISSIONS = [
  ...RESERVATIONS_PERMISSIONS,
  'projects:read',
  'projects:write',
  'calendar_sync:write',
];

const HR_PERMISSIONS = [
  'users:read',
  'users:write',
  'payroll:read',
  'payroll:write',
  'deductions:read',
  'deductions:write',
  'holiday_requests:read',
  'holiday_requests:write',
  'job_offers:read',
  'job_offers:write',
  'attendance:read',
  'attendance:write',
  'loans:read',
  'loans:write',
  'wfh:read',
  'wfh:write',
  'tasks:read',
  'tasks:write',
  'notifications:read',
  'documents:read',
  'documents:write',
];

const HR_PAGE_ACCESS = new Set([
  'users',
  'payroll',
  'deductions',
  'requests',
  'holiday_access',
  'job_offers',
  'attendance',
  'payslip',
  'tasks',
  'profile',
]);

const HR_AGENT_PAGE_ACCESS = new Set([...HR_PAGE_ACCESS, 'reservations']);

const HR_SUPERVISOR_PAGE_ACCESS = new Set([...HR_PAGE_ACCESS, 'reservations']);

const PERMISSIONS = {
  admin: ['*'],
  reservations: RESERVATIONS_WEB_PERMISSIONS,
  reservations_web: RESERVATIONS_WEB_PERMISSIONS,
  reservations_manual: RESERVATIONS_MANUAL_PERMISSIONS,
  reservations_manager: [
    'units:read',
    'units:write',
    'reservations:read',
    'reservations:write',
    'reservations:confirm',
    'reservations:delete',
    'schedule:read',
    'calendar_sync:write',
    'performance:read',
    'reservation_audit:read',
    'projects:read',
    'projects:write',
    'notifications:read',
    'documents:read',
    'documents:write',
  ],
  unit_acquisition_agent: [
    'units:read',
    'units:write',
    'notifications:read',
    'documents:read',
    'documents:write',
  ],
  unit_acquisition_manager: [
    'units:read',
    'units:write',
    'acquisition:read',
    'acquisition:write',
    'owners:read',
    'owners:write',
    'notifications:read',
    'documents:read',
    'documents:write',
  ],
  resale: ['tasks:read', 'notifications:read', 'profile:read'],
  resale_manager: ['tasks:read', 'notifications:read', 'profile:read'],
  hr: HR_PERMISSIONS,
  hr_supervisor: [...HR_PERMISSIONS, 'holiday_access:write'],
  operations: [
    'ops_checkins:read',
    'ops_checkins:write',
    'hk_today:read',
    'hk_today:write',
    'units:read',
    'reservations:read',
    'reservations:write',
    'schedule:read',
    'notifications:read',
    'profile:read',
  ],
  operations_supervisor: [
    'ops_checkins:read',
    'ops_checkins:write',
    'ops_checkins:assign',
    'ops_comments:read',
    'ops_comments:write',
    'hk_today:read',
    'hk_today:write',
    'hk_today:assign',
    'units:read',
    'reservations:read',
    'reservations:write',
    'schedule:read',
    'notifications:read',
    'profile:read',
  ],
  owner: [
    'owner:dashboard',
    'owner:reservations',
    'owner:statement',
    'owner:payouts',
  ],
  owners_relations: [
    'units:read',
    'units:write',
    'reservations:read',
    'reservations:or_checklist',
    'owner_statement:read',
    'owner_blocks:write',
    'notifications:read',
    'profile:read',
  ],
  finance: [
    'financial_system:read',
    'financial_system:write',
    'notifications:read',
    'profile:read',
  ],
  finance_manager: [
    'financial_system:read',
    'financial_system:write',
    'finance_audit:read',
    'notifications:read',
    'profile:read',
  ],
  marketing_pr: ['tasks:read', 'notifications:read', 'profile:read'],
  web_developer: ['tasks:read', 'notifications:read', 'profile:read'],
};


const PAGE_ACCESS = {
  admin: true,
  reservations: RESERVATIONS_WEB_PAGE_ACCESS,
  reservations_web: RESERVATIONS_WEB_PAGE_ACCESS,
  reservations_manual: RESERVATIONS_MANUAL_PAGE_ACCESS,
  reservations_manager: RESERVATIONS_MANAGER_PAGE_ACCESS,
  unit_acquisition_agent: UNIT_ACQUISITION_AGENT_PAGE_ACCESS,
  unit_acquisition_manager: UNIT_ACQUISITION_MANAGER_PAGE_ACCESS,
  operations: OPERATIONS_PAGE_ACCESS,
  operations_supervisor: OPERATIONS_SUPERVISOR_PAGE_ACCESS,
  resale: RESALE_PAGE_ACCESS,
  resale_manager: RESALE_MANAGER_PAGE_ACCESS,
  hr: HR_AGENT_PAGE_ACCESS,
  hr_supervisor: HR_SUPERVISOR_PAGE_ACCESS,
  owners_relations: new Set([
    'units',
    'reservations',
    'owner_statement',
    'owner_blocks',
    'tasks',
    ...STAFF_HR_TABS,
  ]),
  finance: FINANCE_PAGE_ACCESS,
  finance_manager: FINANCE_MANAGER_PAGE_ACCESS,
  marketing_pr: MARKETING_PR_PAGE_ACCESS,
  web_developer: WEB_DEVELOPER_PAGE_ACCESS,
  owner: new Set([
    'owner',
    'owner_reservations',
    'owner_statement',
    'owner_payouts',
    'owner_blocks',
    'profile',
  ]),
};

export function isReservationsTeam(user) {
  return !!user && RESERVATIONS_TEAM.has(user.role);
}

export function isWebsiteReservationsRole(user) {
  return !!user && (user.role === 'reservations_web' || user.role === 'reservations');
}

export function isManualReservationsRole(user) {
  return !!user && (user.role === 'reservations_manual' || user.role === 'reservations');
}

export function isReservationsManager(user) {
  return !!user && user.role === 'reservations_manager';
}

export function isFinanceAgent(user) {
  return !!user && user.role === 'finance';
}

export function isFinanceManager(user) {
  return !!user && user.role === 'finance_manager';
}

export function isFinanceStaff(user) {
  return isFinanceAgent(user) || isFinanceManager(user);
}

export function financeUsersForActor(users, actor) {
  if (!actor || actor.role === 'admin' || !isFinanceManager(actor)) return users || [];
  return (users || []).filter(
    (u) => String(u.id) === String(actor.id) || String(u.manager_id) === String(actor.id)
  );
}

export function isResaleAgent(user) {
  return !!user && user.role === 'resale';
}

export function isResaleManager(user) {
  return !!user && user.role === 'resale_manager';
}

export function isResaleStaff(user) {
  return isResaleAgent(user) || isResaleManager(user);
}

export function resaleUsersForActor(users, actor) {
  if (!actor || actor.role === 'admin' || !isResaleManager(actor)) return users || [];
  return (users || []).filter(
    (u) => String(u.id) === String(actor.id) || String(u.manager_id) === String(actor.id)
  );
}

export function isUnitAcquisitionRole(user) {
  return (
    !!user &&
    (user.role === 'unit_acquisition_agent' || user.role === 'unit_acquisition_manager')
  );
}

export function isUnitAcquisitionManager(user) {
  return !!user && user.role === 'unit_acquisition_manager';
}

export function isUnitAcquisitionAgent(user) {
  return !!user && user.role === 'unit_acquisition_agent';
}

export function salesUsersForActor(users, actor) {
  if (!actor) return users || [];
  if (actor.role === 'admin') return users || [];
  return (users || []).filter((u) => String(u.id) === String(actor.id));
}

export function hasPermission(user, permission) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return (PERMISSIONS[user.role] || []).includes(permission);
}

export function canReceiveStaffTasks(role) {
  const r = String(role || '');
  if (r === 'owner' || r === 'admin') return false;
  if (r.endsWith('_manager') || r.endsWith('_supervisor')) return false;
  return true;
}

export function isTaskAssigneeRole(user) {
  return !!user && canReceiveStaffTasks(user.role);
}

/** Only roles on the User Management line-manager list may assign tasks. */
export function isStaffTaskManagerRole(role) {
  return isLineManagerRole(role);
}

export function canAssignStaffTasks(user) {
  return !!user && isLineManagerRole(user.role);
}

/** Only the creator (or CEO) may edit/delete a task they assigned. */
export function canEditStaffTask(user, task) {
  if (!user || !task) return false;
  if (!canAssignStaffTasks(user)) return false;
  if (user.role === 'admin') return true;
  return String(task.created_by) === String(user.id);
}

export function canAccess(user, page) {
  if (!user) return false;
  if (page === 'profile' || page === 'change-password') return true;
  // Legacy paths still resolve to the merged Requests page.
  if (page === 'holiday_requests' || page === 'loans' || page === 'wfh') {
    page = 'requests';
  }
  // A custom role narrows its base role to the pages picked in User Management.
  if (Array.isArray(user.custom_role_pages)) {
    const key = page === 'units_long_term' && user.role !== 'admin' ? 'units' : page;
    if (!user.custom_role_pages.includes(key)) return false;
  }
  if (user.role === 'admin') return true;
  const allowed = PAGE_ACCESS[user.role];
  if (allowed === true) return true;
  // Long-term units share access with the short-term units page.
  if (page === 'units_long_term') page = 'units';
  if (allowed instanceof Set) return allowed.has(page);
  return false;
}

export function canManageUnits(user) {
  return (
    !!user &&
    (user.role === 'admin' ||
      user.role === 'reservations_manager' ||
      user.role === 'reservations_web' ||
      user.role === 'reservations_manual' ||
      user.role === 'reservations' ||
      user.role === 'owners_relations' ||
      isFinanceStaff(user) ||
      isUnitAcquisitionRole(user))
  );
}

export function canManageLongTermUnits(user) {
  return (
    !!user &&
    (user.role === 'admin' ||
      isReservationsTeam(user) ||
      isReservationsManager(user) ||
      user.role === 'owners_relations' ||
      isUnitAcquisitionRole(user))
  );
}

export function canReserveLongTermUnits(user) {
  return (
    !!user &&
    (user.role === 'admin' ||
      isReservationsTeam(user) ||
      isReservationsManager(user) ||
      isUnitAcquisitionRole(user))
  );
}

export function canDeleteUnits(user) {
  return (
    !!user &&
    (user.role === 'admin' || isUnitAcquisitionRole(user))
  );
}

function isOperationsRole(user) {
  return !!user && (user.role === 'operations' || user.role === 'operations_supervisor');
}

export function canManageReservations(user) {
  return (
    !!user &&
    (user.role === 'admin' ||
      isManualReservationsRole(user) ||
      isWebsiteReservationsRole(user) ||
      isReservationsManager(user) ||
      isOperationsRole(user) ||
      isFinanceStaff(user) ||
      isHrTeamRole(user.role) ||
      user.role === 'marketing_pr' ||
      isUnitAcquisitionRole(user))
  );
}

export function canHandleWebsiteBookings(user) {
  return !!user && (user.role === 'admin' || isWebsiteReservationsRole(user));
}

export function canViewAllReservations(user) {
  return !!user && (user.role === 'admin' || user.role === 'owners_relations');
}

export function canEditOrChecklist(user) {
  return (
    !!user &&
    (user.role === 'admin' ||
      user.role === 'owners_relations' ||
      user.role === 'unit_acquisition_manager')
  );
}

export function isOwnersRelationsRole(user) {
  return !!user && user.role === 'owners_relations';
}

export function canViewOwnCommissions(user) {
  return !!user && (user.role === 'admin' || isReservationsTeam(user));
}

export function isResaleRole(user) {
  return isResaleStaff(user);
}

export function isFinanceRole(user) {
  return isFinanceAgent(user);
}

/** Schedule grid create/move/edit stays (not just viewing). */
export function canWriteSchedule(user) {
  return (
    !!user &&
    (user.role === 'admin' ||
      user.role === 'reservations_manager' ||
      user.role === 'unit_acquisition_manager')
  );
}

export function canEditSchedulePricing(user) {
  return !!user && user.role === 'admin';
}

export function canAccessFinance(user) {
  return !!user && user.role === 'admin';
}

export function canAccessFinancialSystem(user) {
  return !!user && (user.role === 'admin' || isFinanceStaff(user));
}

export function canAccessReports(user) {
  return !!user && user.role === 'admin';
}

export function canManageUsers(user) {
  return !!user && (user.role === 'admin' || isHrTeamRole(user.role));
}

export function canManageOwners(user) {
  return (
    !!user &&
    (user.role === 'admin' || user.role === 'unit_acquisition_manager')
  );
}

export function isHrTeamRole(role) {
  return role === 'hr' || role === 'hr_supervisor';
}

export function canSeeRequestQueue(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return isLineManagerRole(user.role);
}

/** HR, HR Manager, line managers, and CEO can open the Requests History tab. */
export function canSeeRequestHistory(user) {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'hr' || user.role === 'hr_supervisor') return true;
  return isLineManagerRole(user.role);
}

export function canRequestStaffBenefits(user) {
  return !!user && user.role !== 'admin' && user.role !== 'owner';
}

/** Any signed-in staff role can request a loan. */
export function canRequestLoan(user) {
  return !!user && Boolean(String(user.role || '').trim());
}

export function canRequestWfh(user) {
  if (!canRequestStaffBenefits(user)) return false;
  const role = user.role;
  if (role === 'operations' || role === 'operations_supervisor' || role === 'web_developer') {
    return false;
  }
  return true;
}

export function canEditStaffCompensation(user, targetUserId) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  // HR / HR Manager can edit pay and leave for any staff, including themselves.
  if (user.role === 'hr' || user.role === 'hr_supervisor') return true;
  return false;
}

export function isOwnerRole(user) {
  return !!user && user.role === 'owner';
}

export const LINE_MANAGER_ROLES = [
  'admin',
  'hr_supervisor',
  'reservations_manager',
  'resale_manager',
  'finance_manager',
  'unit_acquisition_manager',
  'operations_supervisor',
];

export function isLineManagerRole(role) {
  return LINE_MANAGER_ROLES.includes(String(role || ''));
}

export function hasOfficeAttendance(role, staff) {
  if (staff?.office_attendance_exempt) return false;
  const r = String(role || '');
  if (['owner', 'operations', 'web_developer'].includes(r)) return false;
  // Resale Manager and Unit Acquisition Manager are the only line managers on attendance.
  if (r === 'resale_manager' || r === 'unit_acquisition_manager') return true;
  if (isLineManagerRole(r)) return false;
  return true;
}

const RESERVATION_ROLES = ['reservations_web', 'reservations_manual', 'reservations_manager'];
const FIELD_ROLES = ['operations_supervisor', 'operations'];

/** Roles CEO / HR Manager can assign in User Management */
export const HR_MANAGED_STAFF_ROLES = [
  ...RESERVATION_ROLES,
  ...FIELD_ROLES,
  'resale',
  'resale_manager',
  'unit_acquisition_agent',
  'unit_acquisition_manager',
  'marketing_pr',
  'web_developer',
  'hr',
];

/** Staff list role filter (includes legacy / view-only roles) */
export const HR_STAFF_FILTER_ROLES = [
  ...HR_MANAGED_STAFF_ROLES,
  'reservations',
  'finance',
  'finance_manager',
  'hr_supervisor',
];

/** Roles only a CEO can assign in User Management */
export const ADMIN_ONLY_CREATABLE_ROLES = ['admin', 'hr_supervisor', 'finance_manager'];

/** Full role list a CEO can assign in User Management */
export const ADMIN_CREATABLE_ROLES = [...ADMIN_ONLY_CREATABLE_ROLES, ...HR_MANAGED_STAFF_ROLES];

/** Staff list role filter for CEO (includes CEO accounts) */
export const ADMIN_STAFF_FILTER_ROLES = ['admin', ...HR_STAFF_FILTER_ROLES];

export function creatableRoles(actorRole) {
  if (actorRole === 'admin') return ADMIN_CREATABLE_ROLES;
  if (isHrTeamRole(actorRole)) return HR_MANAGED_STAFF_ROLES;
  if (actorRole === 'unit_acquisition_manager') {
    return ['owner'];
  }
  return [];
}

export const ROLE_LABELS = {
  admin: 'CEO',
  reservations: 'Reservations (legacy)',
  reservations_web: 'Website Reservations',
  reservations_manual: 'Manual Reservations',
  reservations_manager: 'Reservations Manager',
  unit_acquisition_agent: 'Unit Acquisition Agent',
  unit_acquisition_manager: 'Unit Acquisition Manager',
  operations: 'Operations',
  operations_supervisor: 'Operations Supervisor',
  housekeeping: 'Housekeeping',
  housekeeping_supervisor: 'Housekeeping Supervisor',
  resale: 'Resale',
  resale_manager: 'Resale Manager',
  finance: 'Finance',
  finance_manager: 'Financial Manager',
  hr: 'HR',
  hr_supervisor: 'HR Manager',
  owners_relations: 'Owner Experience',
  marketing_pr: 'Marketing and PR',
  web_developer: 'Web Developer',
  owner: 'Owner',
};

export const ROLE_COLORS = {
  admin: 'badge-ch-clay',
  reservations: 'badge-ch-orange',
  reservations_web: 'badge-ch-orange',
  reservations_manual: 'badge-ch-orange',
  reservations_manager: 'badge-ch-orange',
  unit_acquisition_agent: 'badge-ch-teal',
  unit_acquisition_manager: 'badge-ch-teal',
  operations: 'badge-ch-teal',
  operations_supervisor: 'badge-ch-teal',
  housekeeping: 'badge-ch-slate',
  housekeeping_supervisor: 'badge-ch-slate',
  resale: 'badge-ch-teal',
  resale_manager: 'badge-ch-teal',
  finance: 'badge-ch-slate',
  finance_manager: 'badge-ch-slate',
  hr: 'badge-ch-slate',
  hr_supervisor: 'badge-ch-slate',
  owners_relations: 'badge-ch-teal',
  marketing_pr: 'badge-ch-orange',
  web_developer: 'badge-ch-slate',
  owner: 'badge-ch-teal',
};

/** PMS pages a custom role can be given, grouped like the sidebar. */
export const PAGE_CATALOG = [
  { page: 'dashboard', label: 'Dashboard', group: 'Overview', path: '/admin/dashboard' },
  { page: 'tasks', label: 'Tasks', group: 'Overview', path: '/admin/tasks' },
  { page: 'units', label: 'Units (Short Term)', group: 'Inventory', path: '/admin/units' },
  { page: 'units_long_term', label: 'Units (Long Term)', group: 'Inventory', path: '/admin/units-long-term', adminOnly: true },
  { page: 'projects', label: 'Destinations', group: 'Inventory', path: '/admin/projects' },
  { page: 'acquisition', label: 'Owner leads', group: 'Inventory', path: '/admin/acquisition' },
  { page: 'owner_statement', label: 'Owner Statement', group: 'Inventory', path: '/admin/owner-statement' },
  { page: 'owner_blocks', label: 'Owner blocks', group: 'Inventory', path: '/admin/owner/blocks' },
  { page: 'owners', label: 'Owner accounts', group: 'Inventory', path: '/admin/users' },
  { page: 'reservations', label: 'Reservations', group: 'Bookings', path: '/admin/reservations' },
  { page: 'website_bookings', label: 'Website requests & history', group: 'Bookings', path: '/admin/reservations?tab=requests' },
  { page: 'schedule', label: 'Schedule', group: 'Bookings', path: '/admin/schedule' },
  { page: 'calendar_sync', label: 'Channel Manager & OTA Inbox', group: 'Bookings', path: '/admin/calendar-sync' },
  { page: 'performance', label: 'Performance', group: 'Bookings', path: '/admin/performance' },
  { page: 'reservation_audit', label: 'Reservation Audit', group: 'Bookings', path: '/admin/reservation-audit' },
  { page: 'operations', label: 'Operations', group: 'Operations', path: '/admin/operations' },
  { page: 'ops_checkins', label: 'Check-ins & checkouts', group: 'Operations' },
  { page: 'hk_today', label: 'Cleans', group: 'Operations' },
  { page: 'ops_comments', label: 'Check-in comments', group: 'Operations' },
  { page: 'financial_system', label: 'Financial System', group: 'Finance', path: '/admin/financial-system' },
  { page: 'finance_audit', label: 'Finance Audit', group: 'Finance', path: '/admin/finance-audit' },
  { page: 'promo_codes', label: 'Promo Codes', group: 'Finance', path: '/admin/promo-codes' },
  { page: 'users', label: 'User Management', group: 'HR', path: '/admin/users' },
  { page: 'attendance', label: 'Attendance', group: 'HR', path: '/admin/attendance' },
  { page: 'requests', label: 'Requests', group: 'HR', path: '/admin/requests' },
  { page: 'holiday_access', label: 'Holidays access', group: 'HR', path: '/admin/holiday-access' },
  { page: 'deductions', label: 'Deductions/Bonus', group: 'HR', path: '/admin/deductions' },
  { page: 'payslip', label: 'Payslip', group: 'HR', path: '/admin/payslip' },
  { page: 'payroll', label: 'Payrolls', group: 'HR', path: '/admin/payroll' },
  { page: 'job_offers', label: 'Job offers', group: 'HR', path: '/admin/job-offers' },
];

/** Pages a custom role built on `baseRole` may include (never more than the base role). */
export function pagesForBaseRole(baseRole) {
  if (!baseRole || baseRole === 'owner') return [];
  const probe = { role: baseRole };
  return PAGE_CATALOG.filter(
    (p) => (baseRole === 'admin' || !p.adminOnly) && canAccess(probe, p.page)
  );
}

/** Display name for a staff member: custom role name first, then the built-in label. */
export function roleLabel(user) {
  if (!user) return '';
  return user.custom_role_name || ROLE_LABELS[user.role] || user.role || '';
}

export function pmsLabel(user) {
  if (!user) return '';
  if (user.custom_role_name) return `${user.custom_role_name} PMS`;
  return PMS_LABELS[user.role] || '';
}

export const PMS_LABELS = {
  admin: 'CEO PMS',
  reservations: 'Reservations PMS',
  reservations_web: 'Website Reservations PMS',
  reservations_manual: 'Manual Reservations PMS',
  reservations_manager: 'Reservations Manager PMS',
  unit_acquisition_agent: 'Unit Acquisition PMS',
  unit_acquisition_manager: 'Unit Acquisition Manager PMS',
  operations: 'Operations PMS',
  operations_supervisor: 'Operations Supervisor PMS',
  housekeeping: 'Housekeeping PMS',
  housekeeping_supervisor: 'Housekeeping Supervisor PMS',
  resale: 'Resale PMS',
  resale_manager: 'Resale Manager PMS',
  finance: 'Finance PMS',
  finance_manager: 'Finance Manager PMS',
  hr: 'HR PMS',
  hr_supervisor: 'HR Manager PMS',
  owners_relations: 'Owner Experience PMS',
  marketing_pr: 'Marketing and PR PMS',
  web_developer: 'Web Developer PMS',
  owner: 'Owner Portal',
};
