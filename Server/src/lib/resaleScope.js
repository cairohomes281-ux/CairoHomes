const RESALE_AGENT_ROLES = ['resale', 'resale_manager'];

function isResaleAgent(user) {
  return user?.role === 'resale';
}

function isResaleManager(user) {
  return user?.role === 'resale_manager';
}

function isResaleStaff(user) {
  return isResaleAgent(user) || isResaleManager(user);
}

function isAdmin(user) {
  return user?.role === 'admin';
}

function resaleUsersForActor(users, actor) {
  if (!actor || isAdmin(actor) || !isResaleManager(actor)) return users || [];
  return (users || []).filter(
    (u) => String(u.id) === String(actor.id) || String(u.manager_id) === String(actor.id)
  );
}

module.exports = {
  RESALE_AGENT_ROLES,
  isResaleAgent,
  isResaleManager,
  isResaleStaff,
  isAdmin,
  resaleUsersForActor,
};
