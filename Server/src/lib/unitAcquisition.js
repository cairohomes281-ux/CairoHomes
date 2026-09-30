const UNIT_ACQUISITION_ROLES = ['unit_acquisition_agent', 'unit_acquisition_manager'];

function isUnitAcquisitionRole(userOrRole) {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole?.role;
  return UNIT_ACQUISITION_ROLES.includes(String(role || ''));
}

function isUnitAcquisitionManager(userOrRole) {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole?.role;
  return role === 'unit_acquisition_manager';
}

function isUnitAcquisitionAgent(userOrRole) {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole?.role;
  return role === 'unit_acquisition_agent';
}

const ACQUISITION_AUDIT_ACTIONS = [
  'CREATE_UNIT',
  'UPDATE_UNIT',
  'DELETE_UNIT',
  'PUBLISH_UNIT',
  'UNPUBLISH_UNIT',
  'CREATE_ACQUISITION_LEAD',
  'UPDATE_ACQUISITION_LEAD',
  'DELETE_ACQUISITION_LEAD',
  'CREATE_UNIT_FROM_LEAD',
  'LOG_ACQUISITION_NEGOTIATION',
  'CREATE_ACQUISITION_CONTRACT',
];

function isRentOnlyUnitEditor(userOrRole) {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole?.role;
  return (
    role === 'reservations_web' ||
    role === 'reservations_manual' ||
    role === 'reservations' ||
    role === 'owners_relations' ||
    isUnitAcquisitionRole(role)
  );
}

module.exports = {
  UNIT_ACQUISITION_ROLES,
  ACQUISITION_AUDIT_ACTIONS,
  isUnitAcquisitionRole,
  isUnitAcquisitionManager,
  isUnitAcquisitionAgent,
  isRentOnlyUnitEditor,
};
