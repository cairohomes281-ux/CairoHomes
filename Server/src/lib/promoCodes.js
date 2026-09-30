const { query } = require('../config/db');

function normalizeCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

function guestKeyFrom({ email, phone, guestId } = {}) {
  if (guestId) return `id:${guestId}`;
  const e = String(email || '')
    .trim()
    .toLowerCase();
  if (e) return `email:${e}`;
  const p = String(phone || '').replace(/\D/g, '');
  if (p.length >= 8) return `phone:${p}`;
  return null;
}

function applyDiscount(promo, amount) {
  let discounted = Math.max(0, Number(amount) || 0);
  const percent = promo.discount_percent != null ? Number(promo.discount_percent) : null;
  const fixed = promo.discount_amount != null ? Number(promo.discount_amount) : null;
  let discountAmount = 0;

  if (percent && percent > 0) {
    discountAmount = Math.round(discounted * (percent / 100));
    discounted = Math.max(0, discounted - discountAmount);
  } else if (fixed && fixed > 0) {
    discountAmount = Math.min(discounted, fixed);
    discounted = Math.max(0, discounted - discountAmount);
  }

  return {
    discounted_total: discounted,
    discount_amount_applied: discountAmount,
    discount_percent: percent && percent > 0 ? percent : null,
    discount_amount: fixed && fixed > 0 ? fixed : null,
  };
}

async function findActivePromo(code) {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  const { rows } = await query(
    `SELECT * FROM promo_codes
     WHERE upper(code) = $1
       AND active = true
       AND (expires_at IS NULL OR expires_at > now())
       AND (max_uses IS NULL OR used_count < max_uses)`,
    [normalized]
  );
  return rows[0] || null;
}

async function guestAlreadyRedeemed(promoId, guestKey) {
  if (!guestKey) return false;
  const { rows } = await query(
    `SELECT 1 FROM promo_code_redemptions
     WHERE promo_code_id = $1 AND guest_key = $2
     LIMIT 1`,
    [promoId, guestKey]
  );
  return Boolean(rows[0]);
}


async function validatePromo({ code, amount, email, phone, guestId, allowRepeat = false } = {}) {
  const promo = await findActivePromo(code);
  if (!promo) {
    const err = new Error('Invalid or expired promo code');
    err.status = 404;
    throw err;
  }

  const key = guestKeyFrom({ email, phone, guestId });
  const oncePerGuest = promo.once_per_guest !== false;
  if (!allowRepeat && oncePerGuest && key && (await guestAlreadyRedeemed(promo.id, key))) {
    const err = new Error('You have already used this promo code');
    err.status = 409;
    throw err;
  }

  const applied = applyDiscount(promo, amount);
  return {
    valid: true,
    promo,
    code: promo.code,
    once_per_guest: oncePerGuest,
    guest_key: key,
    ...applied,
  };
}


async function redeemPromo({
  code,
  email,
  phone,
  guestId,
  bookingId,
  amountBeforeDiscount,
  client,
  allowRepeat = false,
} = {}) {
  const normalized = normalizeCode(code);
  if (!normalized) return null;

  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `SELECT * FROM promo_codes
     WHERE upper(code) = $1
       AND active = true
       AND (expires_at IS NULL OR expires_at > now())
       AND (max_uses IS NULL OR used_count < max_uses)`,
    [normalized]
  );
  const promo = rows[0];
  if (!promo) {
    const err = new Error('Invalid or expired promo code');
    err.status = 400;
    throw err;
  }

  const key = guestKeyFrom({ email, phone, guestId });
  if (!key) {
    const err = new Error('Guest email or phone is required to use a promo code');
    err.status = 400;
    throw err;
  }

  if (!allowRepeat && promo.once_per_guest !== false) {
    const { rows: existing } = await run(
      `SELECT id FROM promo_code_redemptions
       WHERE promo_code_id = $1 AND guest_key = $2
       LIMIT 1`,
      [promo.id, key]
    );
    if (existing[0]) {
      const err = new Error('You have already used this promo code');
      err.status = 409;
      throw err;
    }
  }

  const applied = applyDiscount(promo, amountBeforeDiscount);
  let reused = false;
  try {
    await run(
      `INSERT INTO promo_code_redemptions
         (promo_code_id, guest_key, guest_email, guest_phone, guest_id, booking_id, discount_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        promo.id,
        key,
        email ? String(email).trim().toLowerCase() : null,
        phone || null,
        guestId || null,
        bookingId || null,
        applied.discount_amount_applied,
      ]
    );
  } catch (e) {
    if (e.code === '23505') {
      if (allowRepeat) {
        reused = true;
      } else {
        const err = new Error('You have already used this promo code');
        err.status = 409;
        throw err;
      }
    } else {
      throw e;
    }
  }

  if (!reused) {
    await run(
      `UPDATE promo_codes
       SET used_count = used_count + 1, updated_at = now()
       WHERE id = $1`,
      [promo.id]
    );
  }

  return { promo, ...applied, guest_key: key, reused };
}

module.exports = {
  normalizeCode,
  guestKeyFrom,
  applyDiscount,
  findActivePromo,
  guestAlreadyRedeemed,
  validatePromo,
  redeemPromo,
};
