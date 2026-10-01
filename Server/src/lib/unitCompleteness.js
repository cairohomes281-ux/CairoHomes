const { beachAccessRequiresManualEntry } = require('./beachAccess');
const { isLongTermUnit } = require('./listingType');

function hasText(v) {
  return String(v || '').trim().length > 0;
}

function hasPhotos(unit) {
  if (hasText(unit.cover_url)) return true;
  if (Array.isArray(unit.photo_urls) && unit.photo_urls.some((u) => hasText(u))) return true;
  return false;
}

function hasAmenities(unit) {
  if (!Array.isArray(unit.amenities)) return false;
  return unit.amenities.some((a) => hasText(a));
}

function descriptionText(unit) {
  return unit.the_property || unit.description || unit.short_description || '';
}

function assessUnitCompleteness(unit, { hasPrice = false } = {}) {
  const missing = [];
  const longTerm = isLongTermUnit(unit);

  if (!hasText(unit.title || unit.name)) missing.push('title');
  if (!hasText(unit.compound || unit.project)) missing.push('project');
  if (!hasText(unit.area || unit.destination)) missing.push('destination');
  if (!hasText(unit.property_type || unit.type)) missing.push('property type');
  if (!hasText(unit.unit_number)) missing.push('unit number');
  if (!hasText(unit.view)) missing.push('view');
  if (unit.beds == null || unit.beds === '' || Number.isNaN(Number(unit.beds))) missing.push('bedrooms');
  if (unit.baths == null || unit.baths === '' || Number.isNaN(Number(unit.baths))) missing.push('bathrooms');
  if (unit.floor == null || unit.floor === '' || Number.isNaN(Number(unit.floor))) missing.push('floor');
  if (!(Number(unit.guests) >= 1)) missing.push('guests');

  if (longTerm) {
    if (!(Number(unit.price_monthly_egp ?? unit.price_monthly) > 0)) missing.push('monthly price');
    if (!(Number(unit.min_nights) >= 1)) missing.push('minimum stay');
  } else {
    if (!hasPrice && !(Number(unit.price_fallback || unit.price_per_night) > 0)) {
      missing.push('price (fallback or daily rates)');
    }
    // Beach access is configured on the project, not the unit.
  }

  if (!hasText(descriptionText(unit))) missing.push('description');
  if (!hasAmenities(unit)) missing.push('amenities');
  if (!hasText(unit.source_url || unit.location_link)) missing.push('location link');
  if (!hasPhotos(unit)) missing.push('photos');

  return { complete: missing.length === 0, missing };
}

function resolveListingStatus({ unit, hasPrice = false } = {}) {
  const assessment = assessUnitCompleteness(unit, { hasPrice });
  return {
    status: assessment.complete ? 'published' : 'draft',
    ...assessment,
  };
}

module.exports = {
  assessUnitCompleteness,
  resolveListingStatus,
  beachAccessRequiresManualEntry,
};
