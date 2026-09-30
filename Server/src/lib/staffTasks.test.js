const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isStaffTaskManagerRole } = require('./staffManagers');
const {
  canAssignTaskTo,
  canManageStaffTasks,
  canEditStaffTask,
  canReceiveStaffTasks,
  isTaskAssigneeRole,
  sqlTaskRecipientRoles,
  staffTaskScopeParams,
} = require('./staffTasks');

describe('staff task access', () => {
  it('treats only line-manager roles as task assigners', () => {
    assert.equal(isStaffTaskManagerRole('admin'), true);
    assert.equal(isStaffTaskManagerRole('hr_supervisor'), true);
    assert.equal(isStaffTaskManagerRole('reservations_manager'), true);
    assert.equal(isStaffTaskManagerRole('finance_manager'), true);
    assert.equal(isStaffTaskManagerRole('operations_supervisor'), true);
    assert.equal(isStaffTaskManagerRole('housekeeping_supervisor'), false);
    assert.equal(canManageStaffTasks({ role: 'resale_manager' }), true);
  });

  it('blocks regular staff including web developers from assigning tasks', () => {
    assert.equal(isStaffTaskManagerRole('web_developer'), false);
    assert.equal(isStaffTaskManagerRole('reservations_web'), false);
    assert.equal(canManageStaffTasks({ role: 'marketing_pr' }), false);
    assert.equal(canManageStaffTasks({ role: 'hr' }), false);
  });

  it('lets only the creator (or CEO) edit or delete a task', () => {
    const creator = { id: 12, role: 'reservations_manager' };
    const otherManager = { id: 13, role: 'finance_manager' };
    const admin = { id: 1, role: 'admin' };
    const task = { id: 9, created_by: 12 };
    assert.equal(canEditStaffTask(creator, task), true);
    assert.equal(canEditStaffTask(otherManager, task), false);
    assert.equal(canEditStaffTask(admin, task), true);
    assert.equal(canEditStaffTask({ id: 12, role: 'reservations_web' }, task), false);
  });

  it('lets staff receive tasks but not managers or owners', () => {
    assert.equal(canReceiveStaffTasks('reservations_web'), true);
    assert.equal(canReceiveStaffTasks('web_developer'), true);
    assert.equal(canReceiveStaffTasks('hr'), true);
    assert.equal(canReceiveStaffTasks('hr_supervisor'), false);
    assert.equal(canReceiveStaffTasks('reservations_manager'), false);
    assert.equal(canReceiveStaffTasks('owner'), false);
    assert.equal(canReceiveStaffTasks('admin'), false);
    assert.equal(isTaskAssigneeRole({ role: 'marketing_pr' }), true);
    assert.equal(isTaskAssigneeRole({ role: 'finance_manager' }), false);
  });

  it('lets HR Manager assign tasks only to direct reports', () => {
    const hrSuper = { id: 8, role: 'hr_supervisor' };
    const webDev = { id: 20, role: 'web_developer', manager_id: 5, manager_ids: [5, 8] };
    const hrStaff = { id: 11, role: 'hr', manager_id: null, manager_ids: [] };
    const managedHr = { id: 12, role: 'hr', manager_id: 8, manager_ids: [8] };
    assert.equal(canAssignTaskTo(hrSuper, webDev), true);
    assert.equal(canAssignTaskTo(hrSuper, hrStaff), false);
    assert.equal(canAssignTaskTo(hrSuper, managedHr), true);
  });

  it('lets department managers assign tasks only when they manage the person', () => {
    const financeManager = { id: 12, role: 'finance_manager' };
    const agent = { id: 21, role: 'finance', manager_id: null, manager_ids: [] };
    const managed = { id: 22, role: 'finance', manager_id: 12, manager_ids: [12] };
    assert.equal(canAssignTaskTo(financeManager, agent), false);
    assert.equal(canAssignTaskTo(financeManager, managed), true);
  });

  it('lets Reservations Manager assign missions to the whole reservation team', () => {
    const reservationsManager = { id: 12, role: 'reservations_manager' };
    const unlinkedWeb = { id: 21, role: 'reservations_web', manager_id: null, manager_ids: [] };
    const unlinkedManual = { id: 22, role: 'reservations_manual', manager_id: 99, manager_ids: [99] };
    const financeAgent = { id: 23, role: 'finance', manager_id: null, manager_ids: [] };
    assert.equal(canAssignTaskTo(reservationsManager, unlinkedWeb), true);
    assert.equal(canAssignTaskTo(reservationsManager, unlinkedManual), true);
    assert.equal(canAssignTaskTo(reservationsManager, financeAgent), false);
  });

  it('omits assigner and assignee names for everyone except CEO', () => {
    const { presentStaffTaskForViewer } = require('./staffTasks');
    const row = {
      id: 1,
      created_by: 12,
      created_by_name: 'Manager',
      assignee_id: 22,
      assignee_name: 'Agent',
      assignee_role: 'reservations_web',
      assignee_email: 'a@x.com',
      title: 'Do thing',
    };
    assert.equal(presentStaffTaskForViewer(row, { role: 'admin' }).created_by_name, 'Manager');
    assert.equal(presentStaffTaskForViewer(row, { role: 'admin' }).assignee_name, 'Agent');
    const hidden = presentStaffTaskForViewer(row, { role: 'reservations_manager' });
    assert.equal(hidden.created_by_name, null);
    assert.equal(hidden.assignee_name, null);
    assert.equal(hidden.assignee_email, null);
    assert.equal(hidden.assignee_id, 22);
    assert.equal(hidden.title, 'Do thing');
  });

  it('omits manager bind params for CEO and Reservations Manager task scope', () => {
    assert.deepEqual(staffTaskScopeParams('admin', 1), []);
    assert.deepEqual(staffTaskScopeParams('reservations_manager', 12), []);
    assert.deepEqual(staffTaskScopeParams('hr_supervisor', 8), [8]);
  });

  it('lets CEO assign tasks to any non-manager staff', () => {
    const admin = { id: 1, role: 'admin' };
    assert.equal(canAssignTaskTo(admin, { id: 21, role: 'reservations_web', manager_id: null }), true);
    assert.equal(canAssignTaskTo(admin, { id: 11, role: 'hr', manager_id: null }), true);
  });

  it('lets CEO assign tasks to marketing and web developer staff', () => {
    const admin = { id: 1, role: 'admin' };
    assert.equal(canAssignTaskTo(admin, { id: 30, role: 'marketing_pr', manager_id: null }), true);
    assert.equal(canAssignTaskTo(admin, { id: 31, role: 'web_developer', manager_id: null }), true);
  });

  it('blocks assigning tasks to other managers', () => {
    const admin = { id: 1, role: 'admin' };
    const reservationsManager = { id: 12, role: 'reservations_manager' };
    assert.equal(canAssignTaskTo(admin, { id: 12, role: 'reservations_manager' }), false);
    assert.equal(
      canAssignTaskTo(reservationsManager, { id: 20, role: 'web_developer', manager_id: 5 }),
      false
    );
  });

  it('generates valid SQL for task recipient roles', () => {
    const sql = sqlTaskRecipientRoles('u');
    assert.match(sql, /u\.role IN \(/);
    assert.match(sql, /'web_developer'/);
    assert.doesNotMatch(sql, /ESCAPE/);
  });
});
