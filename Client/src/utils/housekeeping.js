
export const HOUSEKEEPING_DEFAULT = 1500;
export const HOUSEKEEPING_VILLA = 2500;

export function isVilla(propertyType) {
  const key = String(propertyType || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  return key === 'villa' || key === 'townhouse' || key === 'townhome';
}

export function housekeepingFeeForType(propertyType) {
  return isVilla(propertyType) ? HOUSEKEEPING_VILLA : HOUSEKEEPING_DEFAULT;
}

export function housekeepingFeeForUnit(unit) {
  return housekeepingFeeForType(unit?.property_type || unit?.type);
}
