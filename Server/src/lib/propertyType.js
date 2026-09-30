
const UNIT_TYPES = ['Apartment', 'Studio', 'Villa', 'Penthouse', 'Chalet', 'Hotel Room'];


function normalizePropertyType(type) {
  const raw = String(type || '').trim();
  if (!raw) return raw;
  const key = raw.toLowerCase().replace(/[\s_-]+/g, '');
  if (key === 'townhouse' || key === 'townhome') return 'Villa';
  const known = UNIT_TYPES.find((t) => t.toLowerCase() === raw.toLowerCase());
  return known || raw;
}

module.exports = { UNIT_TYPES, normalizePropertyType };
