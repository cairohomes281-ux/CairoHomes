const express = require('express');
const { query } = require('../config/db');
const { authGuest } = require('../middleware/auth');

const router = express.Router();

const MAX_COMMENT = 500;

async function syncUnitRating(unitId) {
  if (!unitId) return;
  await query(
    `UPDATE units SET
       average_rating = COALESCE((
         SELECT ROUND(AVG(rating)::numeric, 2) FROM reviews
         WHERE unit_id = $1 AND published = true
       ), 0),
       review_count = COALESCE((
         SELECT COUNT(*)::int FROM reviews
         WHERE unit_id = $1 AND published = true
       ), 0),
       updated_at = now()
     WHERE id = $1`,
    [unitId]
  );
}

function mapReview(row) {
  if (!row) return null;
  return {
    id: row.id,
    unit_id: row.unit_id,
    listing_wp_id: row.listing_wp_id,
    guest_user_id: row.guest_user_id,
    guestName: row.guest_name,
    guest_name: row.guest_name,
    rating: Number(row.rating),
    comment: row.comment,
    published: row.published,
    createdAt: row.created_at,
    created_at: row.created_at,
  };
}

async function loadUnit(idOrSlug) {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
  const { rows } = await query(
    isUuid ? 'SELECT * FROM units WHERE id = $1' : 'SELECT * FROM units WHERE slug = $1',
    [idOrSlug]
  );
  return rows[0] || null;
}

async function createReviewHandler(req, res, next) {
  try {
    const unitKey = req.params.unitId || req.body?.unitId || req.body?.unit_id;
    const unit = await loadUnit(unitKey);
    if (!unit) return res.status(404).json({ error: 'Unit not found' });

    const rating = Math.round(Number(req.body?.rating));
    const comment = String(req.body?.comment || '').trim();
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'rating must be an integer from 1 to 5' });
    }
    if (!comment) {
      return res.status(400).json({ error: 'comment is required' });
    }
    if (comment.length > MAX_COMMENT) {
      return res.status(400).json({ error: `comment must be at most ${MAX_COMMENT} characters` });
    }

    let guestName = String(req.body?.guestName || req.body?.guest_name || '').trim();
    if (!guestName) {
      const { rows: profiles } = await query(
        `SELECT full_name, email FROM profiles WHERE id = $1`,
        [req.guest.id]
      );
      guestName = profiles[0]?.full_name || profiles[0]?.email?.split('@')[0] || 'Guest';
    }

    const { rows } = await query(
      `INSERT INTO reviews (unit_id, listing_wp_id, guest_user_id, guest_name, rating, comment, published)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       RETURNING *`,
      [unit.id, unit.wp_post_id || null, req.guest.id, guestName, rating, comment]
    );

    await syncUnitRating(unit.id);

    const { rows: stats } = await query(
      `SELECT average_rating, review_count FROM units WHERE id = $1`,
      [unit.id]
    );

    res.status(201).json({
      review: mapReview(rows[0]),
      average_rating: Number(stats[0]?.average_rating || 0),
      review_count: Number(stats[0]?.review_count || 0),
    });
  } catch (err) {
    next(err);
  }
}


router.post('/unit/:unitId', authGuest, createReviewHandler);


router.post('/', authGuest, createReviewHandler);

module.exports = { router, mapReview, syncUnitRating };
