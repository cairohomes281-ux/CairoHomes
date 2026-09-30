const express = require('express');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { normalizeCode } = require('../../lib/promoCodes');

const router = express.Router();

function mapPromo(row) {
  if (!row) return null;
  return {
    ...row,
    discount_percent: row.discount_percent != null ? Number(row.discount_percent) : null,
    discount_amount: row.discount_amount != null ? Number(row.discount_amount) : null,
    max_uses: row.max_uses != null ? Number(row.max_uses) : null,
    used_count: Number(row.used_count) || 0,
    once_per_guest: row.once_per_guest !== false,
    redemption_count: row.redemption_count != null ? Number(row.redemption_count) : undefined,
  };
}

router.get('/promo-codes', requireRoles('admin'), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT p.*,
              (SELECT count(*)::int FROM promo_code_redemptions r WHERE r.promo_code_id = p.id) AS redemption_count
       FROM promo_codes p
       ORDER BY p.created_at DESC`
    );
    res.json(rows.map(mapPromo));
  } catch (e) {
    next(e);
  }
});

router.get('/promo-codes/:id', requireRoles('admin'), async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM promo_codes WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Promo code not found' });

    const { rows: redemptions } = await query(
      `SELECT id, guest_key, guest_email, guest_phone, booking_id, discount_amount, created_at
       FROM promo_code_redemptions
       WHERE promo_code_id = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [req.params.id]
    );

    res.json({ ...mapPromo(rows[0]), redemptions });
  } catch (e) {
    next(e);
  }
});

router.post('/promo-codes', requireRoles('admin'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const code = normalizeCode(b.code);
    if (!code) return res.status(400).json({ error: 'Code is required' });

    const percent = b.discount_percent !== '' && b.discount_percent != null
      ? Number(b.discount_percent)
      : null;
    const amount = b.discount_amount !== '' && b.discount_amount != null
      ? Math.round(Number(b.discount_amount))
      : null;

    if ((!percent || percent <= 0) && (!amount || amount <= 0)) {
      return res.status(400).json({ error: 'Set a discount percent or fixed amount' });
    }
    if (percent && amount) {
      return res.status(400).json({ error: 'Use either percent or fixed amount, not both' });
    }
    if (percent != null && (percent <= 0 || percent > 100)) {
      return res.status(400).json({ error: 'Percent must be between 1 and 100' });
    }

    const maxUses =
      b.max_uses !== '' && b.max_uses != null ? Math.max(1, parseInt(b.max_uses, 10) || 0) : null;
    const expiresAt = b.expires_at ? new Date(b.expires_at) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      return res.status(400).json({ error: 'Invalid expiry date' });
    }

    const { rows } = await query(
      `INSERT INTO promo_codes
         (code, discount_percent, discount_amount, active, expires_at, max_uses,
          description, once_per_guest, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
       RETURNING *`,
      [
        code,
        percent && percent > 0 ? percent : null,
        amount && amount > 0 ? amount : null,
        b.active === false || b.active === 0 || b.active === '0' ? false : true,
        expiresAt,
        maxUses,
        b.description ? String(b.description).trim() : null,
        b.once_per_guest === false || b.once_per_guest === 0 || b.once_per_guest === '0'
          ? false
          : true,
      ]
    );
    res.status(201).json(mapPromo(rows[0]));
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'That promo code already exists' });
    }
    next(e);
  }
});

router.put('/promo-codes/:id', requireRoles('admin'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const { rows: existing } = await query(`SELECT * FROM promo_codes WHERE id = $1`, [
      req.params.id,
    ]);
    if (!existing[0]) return res.status(404).json({ error: 'Promo code not found' });

    const code = b.code !== undefined ? normalizeCode(b.code) : existing[0].code;
    if (!code) return res.status(400).json({ error: 'Code is required' });

    let percent =
      b.discount_percent !== undefined
        ? b.discount_percent === '' || b.discount_percent == null
          ? null
          : Number(b.discount_percent)
        : existing[0].discount_percent != null
          ? Number(existing[0].discount_percent)
          : null;
    let amount =
      b.discount_amount !== undefined
        ? b.discount_amount === '' || b.discount_amount == null
          ? null
          : Math.round(Number(b.discount_amount))
        : existing[0].discount_amount != null
          ? Number(existing[0].discount_amount)
          : null;

    if (percent && amount) {
      
      if (b.discount_percent !== undefined && b.discount_amount === undefined) amount = null;
      else if (b.discount_amount !== undefined && b.discount_percent === undefined) percent = null;
      else return res.status(400).json({ error: 'Use either percent or fixed amount, not both' });
    }
    if ((!percent || percent <= 0) && (!amount || amount <= 0)) {
      return res.status(400).json({ error: 'Set a discount percent or fixed amount' });
    }
    if (percent != null && (percent <= 0 || percent > 100)) {
      return res.status(400).json({ error: 'Percent must be between 1 and 100' });
    }

    const maxUses =
      b.max_uses !== undefined
        ? b.max_uses === '' || b.max_uses == null
          ? null
          : Math.max(1, parseInt(b.max_uses, 10) || 0)
        : existing[0].max_uses;

    let expiresAt = existing[0].expires_at;
    if (b.expires_at !== undefined) {
      if (!b.expires_at) expiresAt = null;
      else {
        expiresAt = new Date(b.expires_at);
        if (Number.isNaN(expiresAt.getTime())) {
          return res.status(400).json({ error: 'Invalid expiry date' });
        }
      }
    }

    const active =
      b.active !== undefined
        ? !(b.active === false || b.active === 0 || b.active === '0')
        : existing[0].active;
    const oncePerGuest =
      b.once_per_guest !== undefined
        ? !(b.once_per_guest === false || b.once_per_guest === 0 || b.once_per_guest === '0')
        : existing[0].once_per_guest !== false;

    const { rows } = await query(
      `UPDATE promo_codes SET
         code = $2,
         discount_percent = $3,
         discount_amount = $4,
         active = $5,
         expires_at = $6,
         max_uses = $7,
         description = $8,
         once_per_guest = $9,
         updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        req.params.id,
        code,
        percent && percent > 0 ? percent : null,
        amount && amount > 0 ? amount : null,
        active,
        expiresAt,
        maxUses,
        b.description !== undefined
          ? b.description
            ? String(b.description).trim()
            : null
          : existing[0].description,
        oncePerGuest,
      ]
    );
    res.json(mapPromo(rows[0]));
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'That promo code already exists' });
    }
    next(e);
  }
});

router.delete('/promo-codes/:id', requireRoles('admin'), async (req, res, next) => {
  try {
    const { rowCount } = await query(`DELETE FROM promo_codes WHERE id = $1`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Promo code not found' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
