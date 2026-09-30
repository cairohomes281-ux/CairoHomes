const express = require('express');
const { validatePromo, normalizeCode } = require('../lib/promoCodes');
const { optionalGuest } = require('../middleware/auth');

const router = express.Router();

router.post('/validate', optionalGuest, async (req, res, next) => {
  try {
    const { code, amount, email, phone } = req.body || {};
    if (!normalizeCode(code)) {
      return res.status(400).json({ valid: false, error: 'Promo code is required' });
    }

    const result = await validatePromo({
      code,
      amount,
      email: email || req.guest?.email,
      phone,
      guestId: req.guest?.id,
    });

    res.json({
      valid: true,
      code: result.code,
      discount_percent: result.discount_percent,
      discount_amount: result.discount_amount,
      discount_amount_applied: result.discount_amount_applied,
      discounted_total: result.discounted_total,
      once_per_guest: result.once_per_guest,
    });
  } catch (err) {
    if (err.status === 404 || err.status === 409) {
      return res.status(err.status).json({ valid: false, error: err.message });
    }
    next(err);
  }
});

module.exports = router;
