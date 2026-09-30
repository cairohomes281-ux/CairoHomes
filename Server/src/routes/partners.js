const express = require('express');
const { query } = require('../config/db');
const {
  attachFacilities,
  projectFacilitiesMap,
  loadTodayPriceMap,
} = require('./units');

const router = express.Router();

function requirePartnerInventoryKey(req, res, next) {
  const secret = process.env.PARTNER_INVENTORY_API_KEY;
  if (!secret) {
    return res.status(503).json({ error: 'Partner inventory API is not configured' });
  }
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const headerKey = String(req.headers['x-api-key'] || '').trim();
  const key = bearer || headerKey;
  if (!key || key !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

router.use(requirePartnerInventoryKey);

const LIST_SELECT = `
  u.id, u.slug, u.title, u.status, u.compound, u.area, u.city, u.beds, u.baths, u.guests,
  u.cover_url,
  CASE
    WHEN u.photo_urls IS NULL THEN NULL
    ELSE u.photo_urls[1:5]
  END AS photo_urls,
  u.wp_post_id, u.featured, u.price_currency, u.property_type, u.price_fallback,
  u.size_m2, u.listing_type, u.created_at, u.short_description, u.amenities,
  u.commission_mode, u.commission_tenant_pct,
  COALESCE(u.average_rating, 0) AS average_rating,
  COALESCE(u.review_count, 0) AS review_count
`;

const PUBLISHED_RENT = `u.status = 'published' AND COALESCE(u.listing_type, 'rent') = 'rent'`;

router.get('/v1/inventory', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const { rows } = await query(
      `SELECT ${LIST_SELECT}
       FROM units u
       WHERE ${PUBLISHED_RENT}
       ORDER BY u.featured DESC, u.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const countRes = await query(
      `SELECT count(*)::int AS c FROM units u WHERE ${PUBLISHED_RENT}`
    );
    const facilitiesByProject = await projectFacilitiesMap(rows.map((r) => r.compound || r.project));
    const { today, map: todayPriceByWp } = await loadTodayPriceMap(rows.map((r) => r.wp_post_id));

    res.json({
      items: rows.map((r) => attachFacilities(r, facilitiesByProject, todayPriceByWp, today)),
      total: countRes.rows[0].c,
      limit,
      offset,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/v1/inventory/:idOrSlug', async (req, res, next) => {
  try {
    const key = req.params.idOrSlug;
    const isUuid = /^[0-9a-f-]{36}$/i.test(key);
    const { rows } = await query(
      isUuid
        ? `SELECT * FROM units u WHERE u.id = $1 AND ${PUBLISHED_RENT}`
        : `SELECT * FROM units u WHERE u.slug = $1 AND ${PUBLISHED_RENT}`,
      [key]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Unit not found' });

    const facilitiesByProject = await projectFacilitiesMap([
      rows[0].compound || rows[0].project,
    ]);
    const { today, map: todayPriceByWp } = await loadTodayPriceMap([rows[0].wp_post_id]);
    res.json(attachFacilities(rows[0], facilitiesByProject, todayPriceByWp, today));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
