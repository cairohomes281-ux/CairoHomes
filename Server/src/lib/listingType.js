const RENT = 'rent';
const LONG_TERM = 'long_term';
const LISTING_TYPES = [RENT, LONG_TERM];

const RESERVATIONS_TEAM_ROLES = [
  'reservations_manager',
  'reservations_web',
  'reservations_manual',
  'reservations',
];
const ACQUISITION_ROLES = ['unit_acquisition_agent', 'unit_acquisition_manager'];

const LONG_TERM_UNIT_ROLES = ['admin', ...RESERVATIONS_TEAM_ROLES, 'owners_relations', ...ACQUISITION_ROLES];
const LONG_TERM_RESERVATION_ROLES = ['admin', ...RESERVATIONS_TEAM_ROLES, ...ACQUISITION_ROLES];

function normalizeListingType(value, fallback = RENT) {
  const v = String(value || '').trim().toLowerCase().replace(/-/g, '_');
  if (v === LONG_TERM || v === 'longterm' || v === 'long_term_rent' || v === 'sale') return LONG_TERM;
  if (v === RENT) return RENT;
  return fallback;
}

function isLongTermUnit(unit) {
  return normalizeListingType(unit?.listing_type) === LONG_TERM;
}

function roleOf(userOrRole) {
  return String((typeof userOrRole === 'string' ? userOrRole : userOrRole?.role) || '');
}

function canManageLongTermUnits(userOrRole) {
  return LONG_TERM_UNIT_ROLES.includes(roleOf(userOrRole));
}

function canReserveLongTermUnits(userOrRole) {
  return LONG_TERM_RESERVATION_ROLES.includes(roleOf(userOrRole));
}

module.exports = {
  RENT,
  LONG_TERM,
  LISTING_TYPES,
  LONG_TERM_UNIT_ROLES,
  LONG_TERM_RESERVATION_ROLES,
  normalizeListingType,
  isLongTermUnit,
  canManageLongTermUnits,
  canReserveLongTermUnits,
};
