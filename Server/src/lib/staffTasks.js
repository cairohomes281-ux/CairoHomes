const {
  sqlStaffManagedBy,
  isDirectStaffManager,
  isStaffTaskManagerRole,
} = require('./staffManagers');

const STAFF_TASK_RECIPIENT_ROLES = [
  'reservations',
  'reservations_web',
  'reservations_manual',
  'unit_acquisition_agent',
  'operations',
  'resale',
  'finance',
  'hr',
  'owners_relations',
  'marketing_pr',
  'web_developer',
];

/** Roles the Reservations Manager can assign missions/tasks to (whole desk). */
const RESERVATION_TEAM_TASK_ROLES = ['reservations', 'reservations_web', 'reservations_manual'];

function sqlTaskRecipientRoles(staffAlias = 'u') {
  const list = STAFF_TASK_RECIPIENT_ROLES.map((role) => `'${role}'`).join(', ');
  return `${staffAlias}.role IN (${list})`;
}

function sqlReservationTeamRoles(staffAlias = 'u') {
  const list = RESERVATION_TEAM_TASK_ROLES.map((role) => `'${role}'`).join(', ');
  return `${staffAlias}.role IN (${list})`;
}

function isReservationTeamTaskRole(role) {
  return RESERVATION_TEAM_TASK_ROLES.includes(String(role || ''));
}

function canReceiveStaffTasks(role) {
  const r = String(role || '');
  if (r === 'owner' || r === 'admin') return false;
  return STAFF_TASK_RECIPIENT_ROLES.includes(r);
}

function isTaskAssigneeRole(userOrRole) {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole?.role;
  return canReceiveStaffTasks(role);
}

function canManageStaffTasks(actor) {
  return !!actor && isStaffTaskManagerRole(actor.role);
}

/** Only the creator (or CEO) may edit/delete a task. */
function canEditStaffTask(actor, task) {
  if (!actor || !task) return false;
  if (!canManageStaffTasks(actor)) return false;
  if (actor.role === 'admin') return true;
  return String(task.created_by) === String(actor.id);
}

function canAssignTaskTo(actor, assignee) {
  if (!actor || !assignee) return false;
  if (String(actor.id) === String(assignee.id)) return false;
  if (!canReceiveStaffTasks(assignee.role)) return false;
  if (actor.role === 'admin') return true;
  // Reservations Manager owns the whole reservation desk, not only linked reports.
  if (actor.role === 'reservations_manager' && isReservationTeamTaskRole(assignee.role)) {
    return true;
  }
  // Other managers may only assign to staff linked to them (manager_id / staff_user_managers).
  return isDirectStaffManager(actor.id, assignee);
}

/** Only CEO sees who assigned a task and to whom. */
function presentStaffTaskForViewer(row, actor) {
  if (!row) return row;
  if (actor?.role === 'admin') return row;
  return {
    ...row,
    created_by_name: null,
    assignee_name: null,
    assignee_role: null,
    assignee_email: null,
  };
}
function sqlLineManagerTaskScope(managerParam, staffAlias = 'u') {
  return sqlStaffManagedBy(managerParam, staffAlias);
}

function staffTaskScopeSql(managerParam, staffAlias, actorRole) {
  if (actorRole === 'admin') {
    return sqlTaskRecipientRoles(staffAlias);
  }
  if (actorRole === 'reservations_manager') {
    return sqlReservationTeamRoles(staffAlias);
  }
  return `(
    ${sqlLineManagerTaskScope(managerParam, staffAlias)}
    AND ${sqlTaskRecipientRoles(staffAlias)}
  )`;
}

function staffTaskScopeParams(actorRole, managerId) {
  if (actorRole === 'admin' || actorRole === 'reservations_manager') return [];
  return [managerId];
}

module.exports = {
  STAFF_TASK_RECIPIENT_ROLES,
  RESERVATION_TEAM_TASK_ROLES,
  canReceiveStaffTasks,
  isReservationTeamTaskRole,
  isTaskAssigneeRole,
  canManageStaffTasks,
  canEditStaffTask,
  canAssignTaskTo,
  presentStaffTaskForViewer,
  sqlTaskRecipientRoles,
  sqlReservationTeamRoles,
  sqlStaffManagedBy,
  sqlLineManagerTaskScope,
  staffTaskScopeSql,
  staffTaskScopeParams,
  isStaffTaskManagerRole,
};
