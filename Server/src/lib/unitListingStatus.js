const { query } = require('../config/db');
const { resolveListingStatus } = require('./unitCompleteness');
const { isLongTermUnit } = require('./listingType');

function parseOtherDetails(otherDetails) {
  if (!otherDetails) return {};
  try {
    const parsed = typeof otherDetails === 'string' ? JSON.parse(otherDetails) : otherDetails;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function isListingManuallyUnpublished(unit) {
  return parseOtherDetails(unit?.other_details).listing_unpublished === true;
}

async function unitHasPrice(unitId, { priceFallback, wpPostId } = {}) {
  let fallback = Number(priceFallback);
  let postId = wpPostId;
  if (unitId && (priceFallback === undefined || wpPostId === undefined)) {
    const { rows } = await query(
      `SELECT price_fallback, wp_post_id FROM units WHERE id = $1`,
      [unitId]
    );
    if (!rows[0]) return false;
    if (priceFallback === undefined) fallback = Number(rows[0].price_fallback);
    if (wpPostId === undefined) postId = rows[0].wp_post_id;
  }
  if (Number(fallback) > 0) return true;
  if (!postId) return false;
  const { rows: priced } = await query(
    `SELECT 1 FROM unit_daily_prices WHERE wp_post_id = $1 AND price > 0 LIMIT 1`,
    [postId]
  );
  return Boolean(priced[0]);
}


async function syncUnitListingStatus(unitId) {
  const { rows } = await query(`SELECT * FROM units WHERE id = $1`, [unitId]);
  const unit = rows[0];
  if (!unit) return null;

  const hasPrice =
    isLongTermUnit(unit)
      ? Number(unit.price_monthly_egp) > 0
      : await unitHasPrice(unitId, {
          priceFallback: unit.price_fallback,
          wpPostId: unit.wp_post_id,
        });
  const resolved = resolveListingStatus({
    unit,
    hasPrice,
  });
  const nextStatus = isListingManuallyUnpublished(unit) ? 'draft' : resolved.status;
  const completeness = { ...resolved, status: nextStatus };
  if (nextStatus === unit.status) {
    return { ...unit, _completeness: completeness };
  }
  const { rows: updated } = await query(
    `UPDATE units SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [nextStatus, unitId]
  );
  return { ...updated[0], _completeness: completeness };
}

async function enforceDraftWithoutPrice(unitId) {
  const synced = await syncUnitListingStatus(unitId);
  const complete = synced?._completeness?.complete;
  const hasPrice = complete
    ? true
    : !(synced?._completeness?.missing || []).includes('price');
  return {
    demoted: synced && synced.status === 'draft',
    hasPrice: Boolean(hasPrice),
    unit: synced,
    completeness: synced?._completeness,
  };
}

module.exports = {
  unitHasPrice,
  syncUnitListingStatus,
  enforceDraftWithoutPrice,
  isListingManuallyUnpublished,
  parseOtherDetails,
};
