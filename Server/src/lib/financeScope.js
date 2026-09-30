const FINANCE_AGENT_ROLES = ['finance', 'finance_manager'];
const FINANCE_ACCESS_ROLES = ['admin', 'finance', 'finance_manager'];

function isFinanceAgent(user) {
  return user?.role === 'finance';
}

function isFinanceManager(user) {
  return user?.role === 'finance_manager';
}

function isFinanceStaff(user) {
  return isFinanceAgent(user) || isFinanceManager(user);
}

function isAdmin(user) {
  return user?.role === 'admin';
}

function financeUsersForActor(users, actor) {
  if (!actor || isAdmin(actor) || !isFinanceManager(actor)) return users || [];
  return (users || []).filter(
    (u) => String(u.id) === String(actor.id) || String(u.manager_id) === String(actor.id)
  );
}

module.exports = {
  FINANCE_AGENT_ROLES,
  FINANCE_ACCESS_ROLES,
  isFinanceAgent,
  isFinanceManager,
  isFinanceStaff,
  isAdmin,
  financeUsersForActor,
};
