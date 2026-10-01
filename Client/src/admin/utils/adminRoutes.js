import { PAGE_CATALOG, canAccess } from './permissions';

const A = '/admin';

/** Landing page for a staff role, or for a staff user (honours custom role pages). */
export function defaultAdminPage(roleOrUser) {
  if (roleOrUser && typeof roleOrUser === 'object') {
    const user = roleOrUser;
    const base = roleDefaultPage(user.role);
    if (!Array.isArray(user.custom_role_pages)) return base;
    const baseEntry = PAGE_CATALOG.find((p) => p.path === base);
    if (baseEntry && canAccess(user, baseEntry.page)) return base;
    const first = PAGE_CATALOG.find((p) => p.path && canAccess(user, p.page));
    return first ? first.path : `${A}/profile`;
  }
  return roleDefaultPage(roleOrUser);
}

function roleDefaultPage(role) {
  switch (role) {
    case 'reservations':
    case 'reservations_web':
    case 'reservations_manual':
    case 'reservations_manager':
      return `${A}/reservations`;
    case 'operations':
    case 'operations_supervisor':
      return `${A}/operations`;
    case 'resale':
    case 'resale_manager':
      return `${A}/tasks`;
    case 'unit_acquisition_agent':
    case 'unit_acquisition_manager':
      return `${A}/units`;
    case 'finance':
    case 'finance_manager':
      return `${A}/financial-system`;
    case 'hr':
    case 'hr_supervisor':
      return `${A}/users`;
    case 'owners_relations':
      return `${A}/reservations`;
    case 'marketing_pr':
      return `${A}/tasks`;
    case 'web_developer':
      return `${A}/tasks`;
    case 'owner':
      return `${A}/owner`;
    default:
      return `${A}/dashboard`;
  }
}


export const ADMIN_LOGIN = '/sign-in';
export const ADMIN_CHANGE_PASSWORD = `${A}/change-password`;
export const ADMIN_OWNER_STATEMENT = `${A}/financial-system?tool=owners`;
