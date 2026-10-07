const test = require('node:test');
const assert = require('node:assert/strict');
const { pageAccessFor, actingPagesFor, actingRoleForRequest } = require('./rolePages');

function staff(role, extra = {}) {
  const user = { role, ...extra };
  user.page_access = pageAccessFor(user);
  user.acting_pages = actingPagesFor(user, user.page_access);
  return user;
}

test('default roles keep their own pages and never act as another role', () => {
  const u = staff('reservations_manager');
  assert.ok(u.page_access.includes('schedule'));
  assert.deepEqual(u.acting_pages, {});
  assert.equal(actingRoleForRequest(u, 'GET', '/pms/financial-system/accounts'), null);
});

test('CEO and owners have no page list', () => {
  assert.equal(pageAccessFor({ role: 'admin' }), null);
  assert.equal(pageAccessFor({ role: 'owner' }), null);
  assert.equal(actingRoleForRequest(staff('admin'), 'POST', '/pms/users'), null);
});

test('a granted page acts as its owner role only on that page API', () => {
  const u = staff('reservations_manager', {
    role_pages: ['reservations', 'schedule', 'financial_system'],
  });
  assert.deepEqual(u.acting_pages, { financial_system: 'finance_manager' });
  assert.equal(actingRoleForRequest(u, 'GET', '/pms/financial-system/accounts'), 'finance_manager');
  assert.equal(actingRoleForRequest(u, 'POST', '/pms/petty-cash'), 'finance_manager');
  assert.equal(actingRoleForRequest(u, 'POST', '/pms/users'), null);
  assert.equal(actingRoleForRequest(u, 'DELETE', '/pms/staff-roles/built-in/hr'), null);
});

test('paths of pages the role has by default keep the real role', () => {
  const u = staff('finance', { role_pages: ['financial_system', 'reservations', 'schedule', 'calendar_sync'] });
  assert.equal(actingRoleForRequest(u, 'PATCH', '/pms/reservations/12'), null);
  assert.equal(actingRoleForRequest(u, 'GET', '/pms/channel-manager/overview'), 'reservations_manager');
});

test('the most specific page prefix wins', () => {
  const u = staff('finance', { role_pages: ['financial_system', 'reservations', 'schedule', 'performance'] });
  assert.equal(actingRoleForRequest(u, 'GET', '/pms/reservation-targets'), 'reservations_manager');
  assert.equal(actingRoleForRequest(u, 'POST', '/pms/reservations-performance'), 'reservations_manager');
});

test('read-only prefixes do not elevate writes', () => {
  const u = staff('web_developer', { role_pages: ['tasks', 'promo_codes'] });
  assert.equal(actingRoleForRequest(u, 'GET', '/pms/units'), 'admin');
  assert.equal(actingRoleForRequest(u, 'DELETE', '/pms/units/4'), null);
  assert.equal(actingRoleForRequest(u, 'POST', '/pms/promo-codes'), 'admin');
});

test('custom roles may hold pages beyond their base role', () => {
  const u = staff('marketing_pr', { custom_role_id: 3, custom_role_pages: ['tasks', 'dashboard', 'nope'] });
  assert.deepEqual(u.page_access, ['tasks', 'dashboard']);
  assert.equal(actingRoleForRequest(u, 'GET', '/pms/dashboard/stats'), 'admin');
});

test('a custom role on the CEO base is narrowed but never acts', () => {
  const u = staff('admin', { custom_role_id: 1, custom_role_pages: ['units', 'units_long_term'] });
  assert.deepEqual(u.page_access, ['units', 'units_long_term']);
  assert.equal(actingRoleForRequest(u, 'GET', '/pms/units'), null);
});

test('job offers map to the recruitment API', () => {
  const u = staff('reservations_manager', { role_pages: ['reservations', 'job_offers'] });
  assert.equal(actingRoleForRequest(u, 'GET', '/recruitment/jobs'), 'hr_supervisor');
});
