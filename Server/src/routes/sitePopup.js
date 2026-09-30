const express = require('express');
const { query } = require('../config/db');

const router = express.Router();


router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT image_url, link_url, updated_at
       FROM site_popup
       WHERE id = 1 AND active = true AND image_url IS NOT NULL AND btrim(image_url) <> ''
       LIMIT 1`
    );
    if (!rows[0]) return res.json(null);
    res.json({
      image_url: rows[0].image_url,
      link_url: rows[0].link_url || null,
      updated_at: rows[0].updated_at,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
