const { query } = require('../config/db');
const { round2 } = require('./commission');


async function buildPricingRecommendation(unitId, { actorId } = {}) {
  const { rows: units } = await query(`SELECT * FROM units WHERE id = $1`, [unitId]);
  const unit = units[0];
  if (!unit) throw Object.assign(new Error('Unit not found'), { status: 404 });

  const beds = Number(unit.beds) || 1;
  const project = unit.project || unit.compound || '';

  let { rows: comps } = await query(
    `SELECT id, title, beds, price_fallback, project, compound, area, is_comparable
     FROM units
     WHERE id <> $1
       AND COALESCE(is_comparable, false) = true
       AND COALESCE(status,'draft') NOT IN ('archived','cancelled','delisted')
       AND beds BETWEEN $2 AND $3
       AND (
         lower(COALESCE(project, compound, '')) = lower($4)
         OR lower(COALESCE(area, '')) = lower(COALESCE($5, ''))
         OR $4 = ''
       )
     ORDER BY ABS(beds - $6), title
     LIMIT 12`,
    [unitId, Math.max(0, beds - 1), beds + 1, project, unit.area || '', beds]
  );

  let compsSource = 'curated_comparable';
  if (!comps.length) {
    const fallback = await query(
      `SELECT id, title, beds, price_fallback, project, compound, area, is_comparable
       FROM units
       WHERE id <> $1
         AND COALESCE(status,'draft') NOT IN ('archived','cancelled','delisted')
         AND beds BETWEEN $2 AND $3
         AND (
           lower(COALESCE(project, compound, '')) = lower($4)
           OR lower(COALESCE(area, '')) = lower(COALESCE($5, ''))
         )
       ORDER BY ABS(beds - $6), title
       LIMIT 12`,
      [unitId, Math.max(0, beds - 1), beds + 1, project, unit.area || '', beds]
    );
    comps = fallback.rows;
    compsSource = 'peer_units';
  }

  const fallbacks = comps
    .map((c) => Number(c.price_fallback))
    .filter((p) => p > 0)
    .sort((a, b) => a - b);

  const ownFallback = Number(unit.price_fallback) || 0;
  let base = ownFallback;
  if (fallbacks.length) {
    const mid = Math.floor(fallbacks.length / 2);
    base =
      fallbacks.length % 2
        ? fallbacks[mid]
        : round2((fallbacks[mid - 1] + fallbacks[mid]) / 2);
  }
  if (!(base > 0)) base = 1500;

  const weekday = round2(base * 0.95);
  const weekend = round2(base * 1.15);
  const peak = round2(base * 1.3);
  const floor = round2(base * 0.85);
  const ceiling = round2(base * 1.45);

  const curatedBoost = compsSource === 'curated_comparable' ? 0.12 : 0;
  const confidence = Math.min(
    0.95,
    round2(0.35 + fallbacks.length * 0.08 + (ownFallback > 0 ? 0.12 : 0) + curatedBoost)
  );

  const reasoning = {
    method: 'rules_comparables_v2',
    comps_source: compsSource,
    base_source: fallbacks.length ? 'comparable_median' : ownFallback > 0 ? 'own_fallback' : 'default',
    comparable_count: comps.length,
    comparable_unit_ids: comps.map((c) => c.id),
    comparable_titles: comps.map((c) => c.title),
    comparable_prices: fallbacks,
    seasonality: {
      weekday_mult: 0.95,
      weekend_mult: 1.15,
      peak_mult: 1.3,
      note: 'Peak assumed Oct–Apr Cairo city season',
    },
    negotiation_range: { floor, ceiling },
    summary: fallbacks.length
      ? `Median of ${fallbacks.length} ${compsSource === 'curated_comparable' ? 'curated' : 'peer'} unit(s) near ${project || unit.area || 'market'} (~${beds} beds). Negotiate between ${floor}–${ceiling} EGP.`
      : ownFallback > 0
        ? `Based on this unit’s fallback (${ownFallback}). Mark peer units as comparable to improve confidence.`
        : 'Default base used — set price_fallback or mark comparable units.',
  };

  const { rows } = await query(
    `INSERT INTO pricing_recommendations (
       unit_id, base_price, weekday_price, weekend_price, peak_price,
       floor_price, ceiling_price, confidence, reasoning, status, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
     RETURNING *`,
    [
      unitId,
      base,
      weekday,
      weekend,
      peak,
      floor,
      ceiling,
      confidence,
      JSON.stringify(reasoning),
      'presented',
      actorId || null,
    ]
  );

  return rows[0];
}


async function applyAcceptedRecommendation(rec, { actorId, days = 60 } = {}) {
  if (!rec.unit_id) return null;
  const base = Number(rec.base_price) || 0;
  if (!(base > 0)) return null;

  await query(
    `UPDATE units SET price_fallback = $1, updated_at = now() WHERE id = $2`,
    [base, rec.unit_id]
  );

  const { rows: u } = await query(`SELECT id, wp_post_id FROM units WHERE id = $1`, [rec.unit_id]);
  let wp = u[0]?.wp_post_id;
  if (wp == null) {
    const { rows: maxRows } = await query(
      `SELECT COALESCE(MAX(wp_post_id), 900000) + 1 AS next FROM units`
    );
    wp = Number(maxRows[0].next);
    await query(`UPDATE units SET wp_post_id = $1 WHERE id = $2`, [wp, rec.unit_id]);
  }

  const start = new Date();
  let seeded = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const dow = d.getDay(); 
    const isWeekend = dow === 5 || dow === 6;
    const month = d.getMonth() + 1;
    const isPeak = month >= 6 && month <= 8;
    let price = base;
    if (isPeak) price = Number(rec.peak_price) || round2(base * 1.3);
    else if (isWeekend) price = Number(rec.weekend_price) || round2(base * 1.15);
    else price = Number(rec.weekday_price) || round2(base * 0.95);

    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${day}`;

    const { rows: prev } = await query(
      `SELECT price FROM unit_daily_prices WHERE wp_post_id = $1 AND date = $2`,
      [wp, dateStr]
    );
    const oldPrice = prev[0] ? Number(prev[0].price) : null;

    await query(
      `INSERT INTO unit_daily_prices (wp_post_id, date, price, currency, source, updated_at)
       VALUES ($1,$2,$3,'EGP','pricing-recommendation',now())
       ON CONFLICT (wp_post_id, date) DO UPDATE SET
         price = EXCLUDED.price, source = EXCLUDED.source, updated_at = now()`,
      [wp, dateStr, Math.round(price)]
    );
    try {
      await query(
        `INSERT INTO price_change_log (unit_id, price_date, old_price, new_price, currency, source, reason, actor_id)
         VALUES ($1,$2,$3,$4,'EGP','pricing-recommendation',$5,$6)`,
        [
          rec.unit_id,
          dateStr,
          oldPrice,
          Math.round(price),
          `Accepted recommendation #${rec.id}`,
          actorId || null,
        ]
      );
    } catch (_) {}
    seeded += 1;
  }

  return { seeded, wp_post_id: wp, price_fallback: base };
}

module.exports = { buildPricingRecommendation, applyAcceptedRecommendation };
