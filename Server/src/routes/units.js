const express = require('express');
const { query } = require('../config/db');
const { quoteStay, getBlockedDates, getStayCheckoutDates, todayIsoBusiness, toIsoDate, nightsBetween } = require('../services/pricing');
const { GUEST_AVAILABILITY_MONTHS } = require('../lib/calendarOccupancy');
const { DEFAULT_MIN_STAY_NIGHTS } = require('../lib/minStay');
const { enrichUnitsWithBeachPolicy, withBeachPolicy } = require('../lib/beachAccess');
const { LONG_TERM, normalizeListingType, isLongTermUnit } = require('../lib/listingType');

const router = express.Router();

/**
 * Guest search: unit must be free for [checkin, checkout) and priced every night.
 * Half-open stays — checkout morning is free for the next arrival.
 */
function appendStayAvailabilityFilters(
  where,
  params,
  i,
  checkinIso,
  checkoutIso,
  stayNights,
  { requireNightlyPrices = true } = {}
) {
  const ci = i;
  params.push(checkinIso);
  i += 1;
  const co = i;
  params.push(checkoutIso);
  i += 1;
  const nightsIdx = i;
  params.push(stayNights);
  i += 1;

  where.push(`COALESCE(u.min_nights, ${DEFAULT_MIN_STAY_NIGHTS}) <= $${nightsIdx}`);

  where.push(`NOT EXISTS (
    SELECT 1 FROM unit_ical_blocks b
    JOIN unit_ota_feeds f ON f.id = b.feed_id
    WHERE b.wp_post_id = u.wp_post_id
      AND b.date >= $${ci}::date AND b.date < $${co}::date
  )`);

  where.push(`NOT EXISTS (
    SELECT 1 FROM unit_blocked_dates b
    WHERE b.wp_post_id = u.wp_post_id
      AND b.date >= $${ci}::date AND b.date < $${co}::date
      AND COALESCE(b.source, 'manual') NOT IN ('reservation', 'reservation_import', 'booking')
  )`);

  where.push(`NOT EXISTS (
    SELECT 1 FROM reservations r
    WHERE r.unit_id = u.id
      AND r.status <> 'cancelled'
      AND r.check_in < $${co}::date
      AND r.check_out > $${ci}::date
  )`);

  where.push(`NOT EXISTS (
    SELECT 1 FROM bookings bk
    WHERE bk.listing_wp_id = u.wp_post_id
      AND bk.status IN ('confirmed', 'pending', 'held')
      AND (bk.hold_expires_at IS NULL OR bk.hold_expires_at > now())
      AND bk.checkin < $${co}::date
      AND bk.checkout > $${ci}::date
  )`);

  if (requireNightlyPrices) {
    where.push(`(
      SELECT COUNT(*)::int
      FROM unit_daily_prices p
      WHERE p.wp_post_id = u.wp_post_id
        AND p.date >= $${ci}::date AND p.date < $${co}::date
        AND COALESCE(p.price, 0) > 0
    ) = $${nightsIdx}`);
  }

  return i;
}


const GUEST_UNIT_OMIT = new Set([
  'unit_number',
  'internal_code',
  'operator_unit_code',
  'source_code',
  'source_unit',
  'source_url',
  'owner_name',
  'owner_email',
  'owner_phone',
  'company_commission_pct',
  'company_commission_owner_pct',
  'commission_mode',
  'commission_tenant_pct',
  'utilities_cost',
  'ops_status',
  'created_by_staff',
  'notes',
  'other_details',
  'last_scrape_at',
  'last_scrape_status',
  'consecutive_scrape_failures',
  'last_failure_reason',
  'last_failure_at',
  'consecutive_missing_from_discovery',
]);

function toPublicUnit(row) {
  if (!row) return row;
  const { applyGuestTenantMarkup } = require('../lib/commission');
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (GUEST_UNIT_OMIT.has(k)) continue;
    out[k] = v;
  }
  
  if (out.price_fallback != null && Number(out.price_fallback) > 0) {
    out.price_fallback = applyGuestTenantMarkup(out.price_fallback, row);
  }
  out.listing_type = normalizeListingType(row.listing_type);
  if (out.listing_type === LONG_TERM) {
    const monthly = Number(row.price_monthly_egp);
    out.price_monthly = monthly > 0 ? applyGuestTenantMarkup(monthly, row) : null;
    out.price_fallback = null;
    out.inquiry_only = true;
  }
  delete out.price_monthly_egp;
  return out;
}

function facilitiesFromOtherDetails(row) {
  try {
    const details =
      typeof row?.other_details === 'string' ? JSON.parse(row.other_details) : row?.other_details;
    if (Array.isArray(details?.facilities)) {
      return details.facilities.map((f) => String(f || '').trim()).filter(Boolean);
    }
  } catch {}
  return [];
}

async function projectFacilitiesMap(projectNames) {
  const names = [...new Set(projectNames.map((n) => String(n || '').trim()).filter(Boolean))];
  if (!names.length) return new Map();
  const { rows } = await query(
    `SELECT name, COALESCE(facilities, '{}'::text[]) AS facilities
     FROM location_projects
     WHERE lower(trim(name)) = ANY($1::text[])`,
    [names.map((n) => n.toLowerCase())]
  );
  const map = new Map();
  for (const r of rows) {
    map.set(String(r.name).toLowerCase(), Array.isArray(r.facilities) ? r.facilities : []);
  }
  return map;
}


async function loadTodayPriceMap(wpPostIds) {
  const today = todayIsoBusiness();
  const ids = [
    ...new Set(
      (wpPostIds || [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    ),
  ];
  if (!ids.length) return { today, map: new Map() };
    const { rows } = await query(
    `SELECT wp_post_id, price
     FROM unit_daily_prices
     WHERE date = $1::date AND wp_post_id = ANY($2::bigint[])`,
    [today, ids]
  );
  const map = new Map();
  for (const r of rows) {
    const price = Number(r.price);
    if (price > 0) map.set(Number(r.wp_post_id), price);
  }
  return { today, map };
}

function attachFacilities(row, facilitiesByProject, todayPriceByWp = null, priceAsOf = null) {
  const out = toPublicUnit(row);
  const key = String(row.compound || row.project || '').trim().toLowerCase();
  const fromProject = key ? facilitiesByProject.get(key) || [] : [];
  const fromUnit = facilitiesFromOtherDetails(row);
  
  out.facilities = fromProject.length ? fromProject : fromUnit;

  
  if (!isLongTermUnit(row) && todayPriceByWp && row.wp_post_id != null) {
    const rawToday = todayPriceByWp.get(Number(row.wp_post_id));
    if (rawToday > 0) {
      const { applyGuestTenantMarkup } = require('../lib/commission');
      const marked = applyGuestTenantMarkup(rawToday, row);
      out.price_fallback = marked;
      out.from_price = marked;
      if (priceAsOf) out.price_as_of = priceAsOf;
    }
  }
  return out;
}

router.get('/', async (req, res, next) => {
  try {
    const {
      compound,
      area,
      destination,
      project,
      projectName,
      beds,
      guests,
      featured,
      q,
      type,
      types,
      property_type,
      status = 'published',
      listing_type: listingTypeParam,
      checkin,
      checkout,
      sort: sortParam,
      limit = 24,
      offset = 0,
    } = req.query;

    const listingType = normalizeListingType(listingTypeParam);
    const where = ["u.status = $1", `COALESCE(u.listing_type, 'rent') = $2`];
    const params = [status, listingType];
    let i = 3;

    
    const compoundFilter = compound || projectName || project;
    const areaFilter = area || destination;

    if (compoundFilter) {
      where.push(`u.compound ILIKE $${i++}`);
      params.push(compoundFilter);
    }
    if (areaFilter) {
      where.push(`u.area ILIKE $${i++}`);
      params.push(areaFilter);
    }
    if (beds) {
      where.push(`u.beds >= $${i++}`);
      params.push(Number(beds));
    }
    if (guests) {
      where.push(`u.guests >= $${i++}`);
      params.push(Number(guests));
    }
    if (featured === 'true') where.push('u.featured = true');
    if (q) {
      where.push(`(u.title ILIKE $${i} OR u.compound ILIKE $${i} OR u.short_description ILIKE $${i})`);
      params.push(`%${q}%`);
      i++;
    }

    const typeRaw = types || type || property_type || '';
    let typeList = String(typeRaw)
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    
    if (typeList.some((t) => t.toLowerCase() === 'villa')) {
      typeList = [...new Set([...typeList, 'Townhouse', 'Town House', 'Townhome'])];
    }
    if (typeList.length === 1) {
      where.push(`u.property_type ILIKE $${i++}`);
      params.push(typeList[0]);
    } else if (typeList.length > 1) {
      const placeholders = typeList.map(() => `$${i++}`);
      where.push(`u.property_type ILIKE ANY(ARRAY[${placeholders.join(', ')}])`);
      params.push(...typeList);
    }

    const checkinIso = toIsoDate(checkin);
    const checkoutIso = toIsoDate(checkout);
    const stayNights =
      checkinIso && checkoutIso ? nightsBetween(checkinIso, checkoutIso) : 0;
    if (checkinIso && checkoutIso && Number.isFinite(stayNights) && stayNights > 0) {
      i = appendStayAvailabilityFilters(where, params, i, checkinIso, checkoutIso, stayNights, {
        requireNightlyPrices: listingType !== LONG_TERM,
      });
    }

    params.push(Number(limit), Number(offset));

    const sort = String(sortParam || '').toLowerCase();
    let orderBy = 'u.featured DESC, u.created_at DESC';
    if (sort === 'reviews-desc') {
      orderBy =
        'COALESCE(u.average_rating, 0) DESC, COALESCE(u.review_count, 0) DESC, u.featured DESC, u.created_at DESC';
    } else if (sort === 'reviews-asc') {
      orderBy =
        'COALESCE(u.average_rating, 0) ASC, COALESCE(u.review_count, 0) ASC, u.featured DESC, u.created_at DESC';
    } else if (sort === 'newest') {
      orderBy = 'u.created_at DESC, u.featured DESC';
    }

    const sql = `
      SELECT u.id, u.slug, u.title, u.status, u.compound, u.project, u.area, u.city, u.beds, u.baths, u.guests,
             u.cover_url,
             CASE
               WHEN u.photo_urls IS NULL THEN NULL
               ELSE u.photo_urls[1:5]
             END AS photo_urls,
             u.wp_post_id, u.featured, u.price_currency, u.property_type, u.price_fallback,
             u.size_m2, u.listing_type, u.price_monthly_egp, u.min_nights, u.created_at,
             u.commission_mode, u.commission_tenant_pct,
             COALESCE(u.average_rating, 0) AS average_rating,
             COALESCE(u.review_count, 0) AS review_count
      FROM units u
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT $${i++} OFFSET $${i}
    `;
    const { rows } = await query(sql, params);
    const countRes = await query(
      `SELECT count(*)::int AS c FROM units u WHERE ${where.join(' AND ')}`,
      params.slice(0, -2)
    );
    const facilitiesByProject = await projectFacilitiesMap(rows.map((r) => r.compound || r.project));
    const { today, map: todayPriceByWp } = await loadTodayPriceMap(rows.map((r) => r.wp_post_id));
    const items = await enrichUnitsWithBeachPolicy(
      rows.map((r) => attachFacilities(r, facilitiesByProject, todayPriceByWp, today))
    );
    res.json({
      items,
      total: countRes.rows[0].c,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/compounds', async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT compound AS name, count(*)::int AS listings
       FROM units WHERE status = 'published' AND COALESCE(listing_type, 'rent') = 'rent'
       GROUP BY compound ORDER BY compound`
    );
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/:idOrSlug', async (req, res, next) => {
  try {
    const key = req.params.idOrSlug;
    const isUuid = /^[0-9a-f-]{36}$/i.test(key);
    const { rows } = await query(
      isUuid ? 'SELECT * FROM units WHERE id = $1' : 'SELECT * FROM units WHERE slug = $1',
      [key]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Unit not found' });
    const facilitiesByProject = await projectFacilitiesMap([
      rows[0].compound || rows[0].project,
    ]);
    const { today, map: todayPriceByWp } = await loadTodayPriceMap([rows[0].wp_post_id]);
    res.json(
      await withBeachPolicy(attachFacilities(rows[0], facilitiesByProject, todayPriceByWp, today))
    );
  } catch (err) {
    next(err);
  }
});

router.get('/:idOrSlug/availability', async (req, res, next) => {
  try {
    const unit = await loadUnit(req.params.idOrSlug);
    if (!unit?.wp_post_id) return res.status(404).json({ error: 'Unit not found' });
    const from = req.query.from || todayIsoBusiness();
    const toDate = new Date(`${from}T00:00:00`);
    toDate.setMonth(toDate.getMonth() + GUEST_AVAILABILITY_MONTHS);
    const to = req.query.to || `${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, '0')}-${String(toDate.getDate()).padStart(2, '0')}`;
    const blocked = await getBlockedDates(unit.wp_post_id, from, to, {
      includeUnpriced: !isLongTermUnit(unit),
    });
    const occupied = new Set(blocked.map((b) => b.date));
    const checkoutDates = (await getStayCheckoutDates(unit.wp_post_id, from, to)).filter(
      (d) => !occupied.has(d)
    );
    res.json({
      wp_post_id: unit.wp_post_id,
      from,
      to,
      blocked,
      checkout_dates: checkoutDates,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:idOrSlug/pricing', async (req, res, next) => {
  try {
    const unit = await loadUnit(req.params.idOrSlug);
    if (!unit?.wp_post_id) return res.status(404).json({ error: 'Unit not found' });
    const from = req.query.from || new Date().toISOString().slice(0, 10);
    const toDate = new Date(from);
    toDate.setMonth(toDate.getMonth() + 3);
    const to = req.query.to || toDate.toISOString().slice(0, 10);
    const { rows } = await query(
      `SELECT date::text AS date, price, currency, source
       FROM unit_daily_prices
       WHERE wp_post_id = $1 AND date >= $2 AND date < $3
       ORDER BY date`,
      [unit.wp_post_id, from, to]
    );
    const map = {};
    const { applyGuestTenantMarkup } = require('../lib/commission');
    for (const r of rows) {
      map[r.date] = applyGuestTenantMarkup(r.price, unit);
    }
    const markedRows = rows.map((r) => ({
      ...r,
      price: applyGuestTenantMarkup(r.price, unit),
    }));
    res.json({ wp_post_id: unit.wp_post_id, prices: map, rows: markedRows });
  } catch (err) {
    next(err);
  }
});

router.get('/:idOrSlug/quote', async (req, res, next) => {
  try {
    const { checkin, checkout, adults, teens, guests } = req.query;
    const unit = await loadUnit(req.params.idOrSlug);
    if (!unit?.wp_post_id) return res.status(404).json({ error: 'Unit not found' });
    if (isLongTermUnit(unit)) {
      return res.status(403).json({
        error: 'Long-term units can only be reserved by inquiry. Please contact us on WhatsApp.',
      });
    }
    if (unit.disable_automatic_reservations) {
      return res.status(403).json({
        error: 'Online reservations are disabled for this unit. Please inquire on WhatsApp.',
      });
    }
    const adultCount = Number(adults || guests || 1);
    const teenCount = Number(teens || 0);
    const quote = await quoteStay({
      wpPostId: unit.wp_post_id,
      checkin,
      checkout,
      unit,
      adults: adultCount,
      teens: teenCount,
    });
    res.json({ unit_id: unit.id, slug: unit.slug, ...quote });
  } catch (err) {
    next(err);
  }
});

router.get('/:idOrSlug/reviews', async (req, res, next) => {
  try {
    const unit = await loadUnit(req.params.idOrSlug);
    if (!unit) return res.status(404).json({ error: 'Unit not found' });
    const { mapReview } = require('./reviews');
    const { rows } = await query(
      `SELECT * FROM reviews WHERE (unit_id = $1 OR listing_wp_id = $2) AND published = true
       ORDER BY created_at DESC`,
      [unit.id, unit.wp_post_id]
    );
    res.json({
      items: rows.map(mapReview),
      average_rating: Number(unit.average_rating || 0),
      review_count: Number(unit.review_count || 0),
    });
  } catch (err) {
    next(err);
  }
});

async function loadUnit(idOrSlug) {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
  const { rows } = await query(
    isUuid ? 'SELECT * FROM units WHERE id = $1' : 'SELECT * FROM units WHERE slug = $1',
    [idOrSlug]
  );
  return rows[0] || null;
}

module.exports = router;
module.exports.toPublicUnit = toPublicUnit;
module.exports.attachFacilities = attachFacilities;
module.exports.projectFacilitiesMap = projectFacilitiesMap;
module.exports.loadTodayPriceMap = loadTodayPriceMap;
