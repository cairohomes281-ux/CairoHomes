const express = require('express');
const { query } = require('../config/db');
const { authGuest } = require('../middleware/auth');

const router = express.Router();

router.get('/', authGuest, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT w.*, u.slug, u.title, u.cover_url, u.compound, u.beds, u.baths, u.guests
       FROM wishlist_items w
       LEFT JOIN units u ON u.wp_post_id = w.listing_wp_id
       WHERE w.user_id = $1
       ORDER BY w.added_at DESC`,
      [req.guest.id]
    );
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/', authGuest, async (req, res, next) => {
  try {
    const { listing_wp_id, listing_slug } = req.body;
    await query(
      `INSERT INTO wishlist_items (user_id, listing_wp_id, listing_slug)
       VALUES ($1,$2,$3)
       ON CONFLICT (user_id, listing_wp_id) DO NOTHING`,
      [req.guest.id, listing_wp_id, listing_slug || null]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/:listingWpId', authGuest, async (req, res, next) => {
  try {
    await query(`DELETE FROM wishlist_items WHERE user_id = $1 AND listing_wp_id = $2`, [
      req.guest.id,
      Number(req.params.listingWpId),
    ]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
