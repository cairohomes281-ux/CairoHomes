

const HOUSEKEEPING_DEFAULT = 1500;
const HOUSEKEEPING_VILLA = 2500;

function isVilla(propertyType) {
  const key = String(propertyType || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  return key === 'villa' || key === 'townhouse' || key === 'townhome';
}

function housekeepingFeeForType(propertyType) {
  return isVilla(propertyType) ? HOUSEKEEPING_VILLA : HOUSEKEEPING_DEFAULT;
}

function housekeepingFeeForUnit(unit) {
  return housekeepingFeeForType(unit?.property_type || unit?.type);
}

module.exports = {
  HOUSEKEEPING_DEFAULT,
  HOUSEKEEPING_VILLA,
  isVilla,
  housekeepingFeeForType,
  housekeepingFeeForUnit,
};
