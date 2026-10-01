
const express = require('express');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { logAudit } = require('../../lib/audit');
const { syncReservationPaymentStatus } = require('../../lib/syncReservationPayment');

const router = express.Router();

const OPS_AGENT = 'operations';
const OPS_SUPER = 'operations_supervisor';

const OPS_ROLES = ['admin', OPS_AGENT, OPS_SUPER];
const OPS_SUPER_ROLES = ['admin', OPS_SUPER];

function todayCairoSql() {
  return `(timezone('Africa/Cairo', now()))::date`;
}

function cairoTodayYmd() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = String(ymd)
    .slice(0, 10)
    .split('-')
    .map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + Number(days || 0)));
  return dt.toISOString().slice(0, 10);
}

/** Ops list ranges: today | tomorrow | week | month (default). */
function parseOpsDateRange(rangeRaw) {
  const key = String(rangeRaw || 'month')
    .trim()
    .toLowerCase();
  const today = cairoTodayYmd();

  if (key === 'today') {
    return { range: 'today', from: today, to: today };
  }
  if (key === 'tomorrow') {
    const tomorrow = addDaysYmd(today, 1);
    return { range: 'tomorrow', from: tomorrow, to: tomorrow };
  }
  if (key === 'week') {
    const [y, m, d] = today.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const from = addDaysYmd(today, mondayOffset);
    const to = addDaysYmd(from, 6);
    return { range: 'week', from, to };
  }

  const [y, m] = today.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { range: 'month', from, to };
}

function isOpsSupervisor(user) {
  return user?.role === 'admin' || user?.role === OPS_SUPER;
}

function roundMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.round(v * 100) / 100;
}

/** Full stay bill = sum of all line items (not accommodation-only). */
function fullBillTotalFromParts(parts) {
  return roundMoney(
    (Number(parts.accommodation_amount) || 0) +
      (Number(parts.beach_access_fees) || 0) +
      (Number(parts.service_fees) || 0) +
      (Number(parts.insurance) || 0) +
      (Number(parts.security_deposit) || 0)
  );
}

function remainingOf(row, billTotal = null) {
  const total =
    billTotal != null && Number.isFinite(Number(billTotal))
      ? Number(billTotal)
      : Number(row.total_amount) || 0;
  const paid = Number(row.amount_paid) || 0;
  return Math.max(0, Math.round((total - paid) * 100) / 100);
}

/** Apply door-edited bill lines, then return the refreshed check-in row. */
async function applyCollectBillEdits(reservationId, bill, row) {
  if (!bill || typeof bill !== 'object') return row;

  const nights = Number(row.nights) || 0;
  const accommodation = roundMoney(bill.accommodation_amount);
  const beach = roundMoney(bill.beach_access_fees);
  const service = roundMoney(bill.service_fees);
  const insurance = roundMoney(bill.insurance);
  const security = roundMoney(bill.security_deposit);

  const finalTotal = roundMoney(accommodation + beach + service + insurance + security);
  if (!(finalTotal > 0) && remainingOf(row) > 0.5) {
    const err = new Error('Edited bill total must be greater than zero');
    err.status = 400;
    throw err;
  }

  const paid = roundMoney(row.amount_paid);
  if (finalTotal + 0.5 < paid) {
    const err = new Error(
      `Final bill (EGP ${finalTotal}) cannot be less than already paid (EGP ${paid})`
    );
    err.status = 400;
    throw err;
  }

  const pricePerNight =
    nights > 0 ? roundMoney(accommodation / nights) : roundMoney(row.price_per_night);

  await query(
    `UPDATE reservations SET
       price_per_night = $2,
       beach_access_fees = $3,
       insurance = $4,
       total_amount = $5,
       updated_at = now()
     WHERE id = $1`,
    [reservationId, pricePerNight, beach, insurance, finalTotal]
  );

  return fetchCheckinRow(reservationId);
}

function moneySatisfied(row) {
  if (Number(row.ops_money_collected) === 1) return true;
  const breakdown = paymentBreakdown(row);
  return remainingOf(row, breakdown.full_bill_total) <= 0.5;
}

function paymentBreakdown(row) {
  const nights = Number(row.nights) || 0;
  const pricePerNight = Number(row.price_per_night) || 0;
  const accommodation = Math.round(pricePerNight * nights * 100) / 100;
  const insurance = Number(row.insurance) || 0;
  const downPayment = Number(row.down_payment) || 0;

  let adults = Math.max(0, Number(row.adults) || 0);
  let children = Math.max(0, Number(row.children) || 0);
  let nannyCount = Math.max(0, Number(row.nanny_count) || 0);
  if (adults <= 0 && Number(row.booking_adults) > 0) adults = Number(row.booking_adults);
  if (children <= 0 && Number(row.booking_children) > 0) children = Number(row.booking_children);
  if (nannyCount <= 0 && Number(row.booking_nanny) > 0) nannyCount = Number(row.booking_nanny);
  if (adults <= 0 && Number(row.booking_guests) > 0) {
    adults = Math.max(1, Number(row.booking_guests) - children - nannyCount);
  }

  let beachAccessFees = Number(row.beach_access_fees);
  if (!Number.isFinite(beachAccessFees) || beachAccessFees < 0) beachAccessFees = 0;

  if (beachAccessFees <= 0 && row.notes) {
    const m = String(row.notes).match(/Beach pass:\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i);
    if (m) {
      const parsed = Number(String(m[1]).replace(/,/g, ''));
      if (Number.isFinite(parsed) && parsed > 0) beachAccessFees = parsed;
    }
  }

  let serviceFees = 0;
  let serviceFeePercent = 15;
  let securityDeposit = Number(row.security_deposit_egp) || 0;
  try {
    const subtotal = accommodation > 0 ? accommodation : Number(row.total_amount) || 0;
    serviceFees = Math.round(Number(subtotal || 0) * (serviceFeePercent / 100));
  } catch {}

  const parts = {
    accommodation_amount: accommodation,
    beach_access_fees: beachAccessFees,
    service_fees: serviceFees,
    insurance,
    security_deposit: securityDeposit,
  };
  const lineSum = fullBillTotalFromParts(parts);
  const storedTotal = roundMoney(row.total_amount);
  // Prefer line-item sum; if DB total is higher (legacy lump / edited extras), keep it.
  const totalAmount = storedTotal > lineSum + 0.5 ? storedTotal : lineSum;

  return {
    nights,
    price_per_night: pricePerNight,
    ...parts,
    service_fee_percent: serviceFeePercent,
    down_payment: downPayment,
    owner_collected_type: row.owner_collected_type || null,
    owner_collected_amount: Number(row.owner_collected_amount) || 0,
    adults,
    children,
    nanny_count: nannyCount,
    guests_total: adults + children + nannyCount,
    total_amount: totalAmount,
    full_bill_total: totalAmount,
  };
}

const CHECKIN_SELECT = `
  SELECT r.*,
          COALESCE(u.unit_number, u.title, 'Unit') AS unit_title,
          u.unit_number,
          u.ops_status AS unit_ops_status,
          COALESCE(u.project, u.compound) AS project,
          u.property_type,
          u.access_fee_per_adult_egp,
          u.access_fee_per_teen_egp,
          u.access_card_count_included,
          u.security_deposit_egp,
          b.adults AS booking_adults,
          b.children AS booking_children,
          b.nanny_count AS booking_nanny,
          b.guests AS booking_guests,
          ops_agent.id AS ops_assignee_id,
          ops_agent.full_name AS ops_assignee_name,
          ops_agent.staff_code AS ops_assignee_code,
          money_by.full_name AS ops_money_collected_by_name,
          hand_by.full_name AS ops_handed_over_by_name
   FROM reservations r
   JOIN units u ON u.id = r.unit_id
   LEFT JOIN bookings b ON b.id = r.booking_id
   LEFT JOIN staff_users ops_agent ON ops_agent.id = r.ops_assigned_to
   LEFT JOIN staff_users money_by ON money_by.id = r.ops_money_collected_by
   LEFT JOIN staff_users hand_by ON hand_by.id = r.ops_handed_over_by
`;

async function fetchCheckinRow(reservationId) {
  const { rows } = await query(`${CHECKIN_SELECT} WHERE r.id = $1`, [reservationId]);
  return rows[0] || null;
}

function mapCheckin(row) {
  const breakdown = paymentBreakdown(row);
  const billTotal = Number(breakdown.full_bill_total) || Number(breakdown.total_amount) || 0;
  const remaining = remainingOf(row, billTotal);
  const moneyCollected =
    Number(row.ops_money_collected) === 1 || remaining <= 0.5;
  const handedOver = Number(row.ops_handed_over) === 1;
  return {
    id: row.id,
    guest_name: row.guest_name,
    guest_phone: row.guest_phone,
    unit_id: row.unit_id,
    unit_number: row.unit_number,
    unit_title: row.unit_title,
    project: row.project,
    check_in: row.check_in,
    check_out: row.check_out,
    status: row.status,
    total_amount: billTotal,
    amount_paid: Number(row.amount_paid) || 0,
    remaining_amount: remaining,
    payment_status: row.payment_status,
    payment_method: row.payment_method,
    payment_breakdown: breakdown,
    ops_money_collected: moneyCollected,
    ops_money_collected_amount: Number(row.ops_money_collected_amount) || 0,
    ops_money_collected_at: row.ops_money_collected_at,
    ops_handed_over: handedOver,
    ops_handed_over_at: row.ops_handed_over_at,
    ops_assigned_to: row.ops_assigned_to || null,
    ops_assigned_at: row.ops_assigned_at || null,
    ops_assignee_name: row.ops_assignee_name || null,
    ops_assignee_code: row.ops_assignee_code || null,
    ops_money_collected_by_name: row.ops_money_collected_by_name || null,
    ops_handed_over_by_name: row.ops_handed_over_by_name || null,
    ops_handover_comment: row.ops_handover_comment || null,
    ops_handover_comment_at: row.ops_handover_comment_at || null,
    ops_handover_comment_by: row.ops_handover_comment_by || null,
    ops_comment_reviewed: Number(row.ops_comment_reviewed) === 1,
    ops_comment_reviewed_at: row.ops_comment_reviewed_at || null,
    can_handover: moneyCollected && !handedOver,
    unit_ops_status: row.unit_ops_status,
  };
}

function assertOpsCanAct(req, row) {
  if (isOpsSupervisor(req.user)) return null;
  if (req.user.role !== OPS_AGENT) return 'Forbidden';
  if (!row.ops_assigned_to || Number(row.ops_assigned_to) !== Number(req.user.id)) {
    return 'This check-in is not assigned to you';
  }
  return null;
}

router.get('/ops/agents', requireRoles(...OPS_SUPER_ROLES), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, full_name, username, staff_code
       FROM staff_users
       WHERE role = $1 AND is_active = 1
       ORDER BY full_name ASC NULLS LAST, username ASC`,
      [OPS_AGENT]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.get('/ops/checkins-today', requireRoles(...OPS_ROLES), async (req, res, next) => {
  try {
    const { range, from, to } = parseOpsDateRange(req.query.range || req.query.period);
    const params = [from, to];
    let scope = '';
    if (req.user.role === OPS_AGENT) {
      params.push(req.user.id);
      scope = ` AND r.ops_assigned_to = $${params.length}`;
    }

    const { rows } = await query(
      `${CHECKIN_SELECT}
       WHERE r.check_in::date >= $1::date
         AND r.check_in::date <= $2::date
         AND r.status IS DISTINCT FROM 'cancelled'
         ${scope}
       ORDER BY r.check_in ASC, u.unit_number ASC NULLS LAST`,
      params
    );
    res.json({ range, from, to, items: rows.map(mapCheckin) });
  } catch (e) {
    next(e);
  }
});

function parseHistoryRange(query) {
  const today = new Date();
  const toDefault = today.toISOString().slice(0, 10);
  const fromDefaultDate = new Date(today);
  fromDefaultDate.setUTCDate(fromDefaultDate.getUTCDate() - 30);
  const fromDefault = fromDefaultDate.toISOString().slice(0, 10);
  const from = String(query.from || query.from_date || fromDefault).slice(0, 10);
  const to = String(query.to || query.to_date || toDefault).slice(0, 10);
  return { from, to };
}

router.get('/ops/checkins-history', requireRoles(...OPS_ROLES), async (req, res, next) => {
  try {
    const { from, to } = parseHistoryRange(req.query);
    const params = [from, to];
    let scope = '';
    if (req.user.role === OPS_AGENT) {
      params.push(req.user.id);
      scope = ` AND r.ops_assigned_to = $${params.length}`;
    }

    const { rows } = await query(
      `${CHECKIN_SELECT}
       WHERE r.check_in::date >= $1::date
         AND r.check_in::date <= $2::date
         AND r.check_in::date < ${todayCairoSql()}
         AND r.status IS DISTINCT FROM 'cancelled'
         AND (
           COALESCE(r.ops_handed_over, 0) = 1
           OR COALESCE(r.ops_money_collected, 0) = 1
           OR r.ops_assigned_to IS NOT NULL
         )
         ${scope}
       ORDER BY r.check_in DESC, u.unit_number ASC NULLS LAST
       LIMIT 500`,
      params
    );
    res.json({ from, to, items: rows.map(mapCheckin) });
  } catch (e) {
    next(e);
  }
});

router.post(
  '/ops/checkins-today/:reservationId/assign',
  requireRoles(...OPS_SUPER_ROLES),
  async (req, res, next) => {
    try {
      const reservationId = Number(req.params.reservationId);
      const staffId = req.body?.staff_id != null ? Number(req.body.staff_id) : null;
      const row = await fetchCheckinRow(reservationId);
      if (!row) return res.status(404).json({ error: 'Reservation not found' });

      if (staffId) {
        const { rows: agents } = await query(
          `SELECT id FROM staff_users WHERE id = $1 AND role = $2 AND is_active = 1`,
          [staffId, OPS_AGENT]
        );
        if (!agents[0]) return res.status(400).json({ error: 'Select an active operations agent' });
      }

      await query(
        `UPDATE reservations SET
           ops_assigned_to = $2::int,
           ops_assigned_at = CASE WHEN $2::int IS NULL THEN NULL ELSE now() END,
           ops_assigned_by = CASE WHEN $2::int IS NULL THEN NULL ELSE $3::int END,
           updated_at = now()
         WHERE id = $1`,
        [reservationId, staffId || null, Number(req.user.id) || null]
      );

      await logAudit({
        userId: req.user.id,
        action: 'OPS_ASSIGN_CHECKIN',
        entityType: 'reservation',
        entityId: reservationId,
        details: { staff_id: staffId || null },
      });

      const updated = await fetchCheckinRow(reservationId);
      res.json(mapCheckin(updated));
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  '/ops/checkins-today/:reservationId/collect',
  requireRoles(...OPS_ROLES),
  async (req, res, next) => {
    try {
      const reservationId = Number(req.params.reservationId);
      let row = await fetchCheckinRow(reservationId);
      if (!row) return res.status(404).json({ error: 'Reservation not found' });
      if (String(row.status).toLowerCase() === 'cancelled') {
        return res.status(409).json({ error: 'Reservation is cancelled' });
      }
      const denied = assertOpsCanAct(req, row);
      if (denied) return res.status(403).json({ error: denied });

      const collectMode = String(req.body?.collect_mode || 'full').toLowerCase() === 'custom'
        ? 'custom'
        : 'full';
      const collectComment = String(req.body?.comment || req.body?.note || '').trim();
      let billApplied = null;
      if (collectMode === 'custom' && req.body?.bill) {
        if (!collectComment) {
          return res.status(400).json({
            error: 'A comment is required when editing the bill before collect',
          });
        }
        const before = {
          total_amount: Number(row.total_amount) || 0,
          price_per_night: Number(row.price_per_night) || 0,
          beach_access_fees: Number(row.beach_access_fees) || 0,
          insurance: Number(row.insurance) || 0,
        };
        row = await applyCollectBillEdits(reservationId, req.body.bill, row);
        billApplied = {
          before,
          after: {
            total_amount: Number(row.total_amount) || 0,
            price_per_night: Number(row.price_per_night) || 0,
            beach_access_fees: Number(row.beach_access_fees) || 0,
            insurance: Number(row.insurance) || 0,
            bill: req.body.bill,
          },
          comment: collectComment,
        };
      }

      const remaining = remainingOf(row, paymentBreakdown(row).full_bill_total);
      if (remaining <= 0.5) {
        await query(
          `UPDATE reservations SET
             ops_money_collected = 1,
             ops_money_collected_at = COALESCE(ops_money_collected_at, now()),
             ops_money_collected_by = COALESCE(ops_money_collected_by, $2),
             ops_money_collected_amount = COALESCE(ops_money_collected_amount, 0),
             updated_at = now()
           WHERE id = $1`,
          [reservationId, req.user.id]
        );
        if (billApplied) {
          await logAudit({
            userId: req.user.id,
            action: 'OPS_EDIT_CHECKIN_BILL',
            entityType: 'reservation',
            entityId: reservationId,
            details: billApplied,
          });
        }
        const updated = await fetchCheckinRow(reservationId);
        return res.json(mapCheckin(updated));
      }

      // Full / custom both collect the full remaining after any bill edit.
      let amount = remaining;
      if (collectMode === 'full') {
        const requested = Number(req.body?.amount);
        if (Number.isFinite(requested) && requested > 0) {
          amount = Math.round(requested * 100) / 100;
        }
      }
      amount = Math.round(amount * 100) / 100;
      if (amount > remaining + 0.5) {
        return res.status(400).json({ error: `Amount cannot exceed remaining EGP ${remaining}` });
      }

      const splits = [];
      const cashAmt = Number(req.body?.cash_amount);
      const instapayAmt = Number(req.body?.instapay_amount);
      const hasSplit =
        (Number.isFinite(cashAmt) && cashAmt > 0) || (Number.isFinite(instapayAmt) && instapayAmt > 0);

      if (hasSplit) {
        const cash = Number.isFinite(cashAmt) && cashAmt > 0 ? Math.round(cashAmt * 100) / 100 : 0;
        const instapay =
          Number.isFinite(instapayAmt) && instapayAmt > 0 ? Math.round(instapayAmt * 100) / 100 : 0;
        if (cash > 0) splits.push({ amount: cash, payment_method: 'cash' });
        if (instapay > 0) splits.push({ amount: instapay, payment_method: 'instapay' });
        const splitTotal = Math.round((cash + instapay) * 100) / 100;
        if (Math.abs(splitTotal - amount) > 0.05) {
          return res.status(400).json({
            error: `Cash + InstaPay (EGP ${splitTotal}) must equal the collected amount (EGP ${amount})`,
          });
        }
        if (splitTotal > remaining + 0.5) {
          return res.status(400).json({ error: `Amount cannot exceed remaining EGP ${remaining}` });
        }
        amount = splitTotal;
      } else {
        let method = String(req.body?.payment_method || 'cash').toLowerCase();
        if (!['cash', 'instapay', 'bank_transfer'].includes(method)) method = 'cash';
        splits.push({ amount, payment_method: method });
      }

      const noteBase = collectComment
        ? `[ops check-in] ${collectComment}`
        : `[ops check-in] Collected at door by ${req.user.full_name || req.user.username || req.user.id}`;
      for (const part of splits) {
        await query(
          `INSERT INTO payments (
             reservation_id, amount, payment_date, payment_method,
             notes, created_by, status, is_approved, approved_by, approved_at, paid_at
           ) VALUES (
             $1, $2, CURRENT_DATE, $3,
             $4, $5, 'successful', 1, $5, now(), now()
           )`,
          [
            reservationId,
            part.amount,
            part.payment_method,
            splits.length > 1 ? `${noteBase} Â· ${part.payment_method} share` : noteBase,
            req.user.id,
          ]
        );
      }

      await syncReservationPaymentStatus(reservationId);

      await query(
        `UPDATE reservations SET
           ops_money_collected = 1,
           ops_money_collected_at = now(),
           ops_money_collected_by = $2,
           ops_money_collected_amount = COALESCE(ops_money_collected_amount, 0) + $3,
           updated_at = now()
         WHERE id = $1`,
        [reservationId, req.user.id, amount]
      );

      if (billApplied) {
        await logAudit({
          userId: req.user.id,
          action: 'OPS_EDIT_CHECKIN_BILL',
          entityType: 'reservation',
          entityId: reservationId,
          details: billApplied,
        });
      }

      await logAudit({
        userId: req.user.id,
        action: 'OPS_COLLECT_CHECKIN',
        entityType: 'reservation',
        entityId: reservationId,
        details: {
          collect_mode: collectMode,
          amount,
          comment: collectComment || null,
          splits: splits.map((s) => ({
            amount: s.amount,
            payment_method: s.payment_method,
          })),
        },
      });

      const updated = await fetchCheckinRow(reservationId);
      res.json(mapCheckin(updated));
    } catch (e) {
      if (e.status === 400) return res.status(400).json({ error: e.message });
      next(e);
    }
  }
);

router.post(
  '/ops/checkins-today/:reservationId/comment',
  requireRoles(OPS_AGENT),
  async (req, res, next) => {
    try {
      const reservationId = Number(req.params.reservationId);
      const row = await fetchCheckinRow(reservationId);
      if (!row) return res.status(404).json({ error: 'Reservation not found' });
      const denied = assertOpsCanAct(req, row);
      if (denied) return res.status(403).json({ error: denied });
      if (Number(row.ops_handed_over) === 1) {
        return res.status(409).json({ error: 'Check-in already handed over' });
      }

      const comment = String(req.body?.comment || '').trim();
      if (!comment) return res.status(400).json({ error: 'Comment is required' });
      if (comment.length > 4000) {
        return res.status(400).json({ error: 'Comment is too long (max 4000 characters)' });
      }

      await query(
        `UPDATE reservations SET
           ops_handover_comment = $2,
           ops_handover_comment_at = now(),
           ops_handover_comment_by = $3,
           ops_comment_reviewed = 0,
           ops_comment_reviewed_at = NULL,
           ops_comment_reviewed_by = NULL,
           updated_at = now()
         WHERE id = $1`,
        [reservationId, comment, req.user.id]
      );

      await logAudit({
        userId: req.user.id,
        action: 'OPS_CHECKIN_COMMENT',
        entityType: 'reservation',
        entityId: reservationId,
        details: { comment_length: comment.length },
      });

      const updated = await fetchCheckinRow(reservationId);
      res.json(mapCheckin(updated));
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  '/ops/checkins-today/:reservationId/handover',
  requireRoles(...OPS_ROLES),
  async (req, res, next) => {
    try {
      const reservationId = Number(req.params.reservationId);
      const row = await fetchCheckinRow(reservationId);
      if (!row) return res.status(404).json({ error: 'Reservation not found' });
      const denied = assertOpsCanAct(req, row);
      if (denied) return res.status(403).json({ error: denied });
      if (Number(row.ops_handed_over) === 1) {
        return res.json(mapCheckin(row));
      }
      if (!moneySatisfied(row)) {
        return res.status(400).json({ error: 'Collect remaining balance before handover' });
      }

      
      let comment = String(req.body?.comment || row.ops_handover_comment || '').trim();
      if (req.user.role === OPS_AGENT) {
        if (!comment) {
          return res.status(400).json({
            error: 'Add a check-in comment before handing the unit to the guest',
          });
        }
        if (comment.length > 4000) {
          return res.status(400).json({ error: 'Comment is too long (max 4000 characters)' });
        }
      }

      await query(
        `UPDATE reservations SET
           ops_handed_over = 1,
           ops_handed_over_at = now(),
           ops_handed_over_by = $2,
           ops_money_collected = 1,
           ops_handover_comment = CASE
             WHEN $3::text IS NULL OR btrim($3::text) = '' THEN ops_handover_comment
             ELSE $3::text
           END,
           ops_handover_comment_at = CASE
             WHEN $3::text IS NULL OR btrim($3::text) = '' THEN ops_handover_comment_at
             ELSE now()
           END,
           ops_handover_comment_by = CASE
             WHEN $3::text IS NULL OR btrim($3::text) = '' THEN ops_handover_comment_by
             ELSE $2
           END,
           status = 'checked_in',
           updated_at = now()
         WHERE id = $1`,
        [reservationId, req.user.id, comment || null]
      );

      try {
        const { markReservationFullyCollected } = require('../../lib/settleReservationMoney');
        await markReservationFullyCollected(reservationId, {
          reason: 'ops_handover_settled',
          actorId: req.user.id,
        });
      } catch (err) {
        console.warn('[ops/handover] money settle failed', err.message);
      }

      await query(
        `UPDATE units SET ops_status = 'occupied', updated_at = now() WHERE id = $1`,
        [row.unit_id]
      );

      await logAudit({
        userId: req.user.id,
        action: 'OPS_HANDOVER_CHECKIN',
        entityType: 'reservation',
        entityId: reservationId,
        details: { unit_id: row.unit_id, has_comment: !!comment },
      });

      const updated = await fetchCheckinRow(reservationId);
      res.json(mapCheckin(updated));
    } catch (e) {
      next(e);
    }
  }
);

router.get('/ops/checkin-comments', requireRoles(...OPS_SUPER_ROLES), async (req, res, next) => {
  try {
    const { from, to } = parseHistoryRange(req.query);
    const status = String(req.query.status || 'all').toLowerCase();
    const params = [from, to];
    let reviewedFilter = '';
    if (status === 'pending') {
      reviewedFilter = ' AND COALESCE(r.ops_comment_reviewed, 0) = 0';
    } else if (status === 'reviewed') {
      reviewedFilter = ' AND COALESCE(r.ops_comment_reviewed, 0) = 1';
    }

    const { rows } = await query(
      `SELECT r.id,
              r.guest_name,
              r.guest_phone,
              r.check_in,
              r.check_out,
              r.ops_handed_over,
              r.ops_handed_over_at,
              r.ops_handover_comment,
              r.ops_handover_comment_at,
              r.ops_comment_reviewed,
              r.ops_comment_reviewed_at,
              u.unit_number,
              COALESCE(u.unit_number, u.title, 'Unit') AS unit_title,
              COALESCE(u.project, u.compound) AS project,
              agent.full_name AS comment_by_name,
              agent.staff_code AS comment_by_code,
              assignee.full_name AS ops_assignee_name,
              reviewer.full_name AS reviewed_by_name
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       LEFT JOIN staff_users agent ON agent.id = r.ops_handover_comment_by
       LEFT JOIN staff_users assignee ON assignee.id = r.ops_assigned_to
       LEFT JOIN staff_users reviewer ON reviewer.id = r.ops_comment_reviewed_by
       WHERE r.ops_handover_comment IS NOT NULL
         AND btrim(r.ops_handover_comment) <> ''
         AND COALESCE(r.ops_handover_comment_at, r.check_in)::date >= $1::date
         AND COALESCE(r.ops_handover_comment_at, r.check_in)::date <= $2::date
         ${reviewedFilter}
       ORDER BY
         COALESCE(r.ops_comment_reviewed, 0) ASC,
         r.ops_handover_comment_at DESC NULLS LAST
       LIMIT 500`,
      params
    );

    res.json({
      from,
      to,
      status,
      items: rows.map((r) => ({
        id: r.id,
        guest_name: r.guest_name,
        guest_phone: r.guest_phone,
        check_in: r.check_in,
        check_out: r.check_out,
        unit_number: r.unit_number,
        unit_title: r.unit_title,
        project: r.project,
        ops_handed_over: Number(r.ops_handed_over) === 1,
        ops_handed_over_at: r.ops_handed_over_at,
        comment: r.ops_handover_comment,
        comment_at: r.ops_handover_comment_at,
        comment_by_name: r.comment_by_name || null,
        comment_by_code: r.comment_by_code || null,
        ops_assignee_name: r.ops_assignee_name || null,
        reviewed: Number(r.ops_comment_reviewed) === 1,
        reviewed_at: r.ops_comment_reviewed_at || null,
        reviewed_by_name: r.reviewed_by_name || null,
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.post(
  '/ops/checkin-comments/:reservationId/reviewed',
  requireRoles(...OPS_SUPER_ROLES),
  async (req, res, next) => {
    try {
      const reservationId = Number(req.params.reservationId);
      const reviewed = req.body?.reviewed === false || req.body?.reviewed === 0 ? 0 : 1;
      const { rows } = await query(
        `UPDATE reservations SET
           ops_comment_reviewed = $2,
           ops_comment_reviewed_at = CASE WHEN $2 = 1 THEN now() ELSE NULL END,
           ops_comment_reviewed_by = CASE WHEN $2 = 1 THEN $3 ELSE NULL END,
           updated_at = now()
         WHERE id = $1
           AND ops_handover_comment IS NOT NULL
           AND btrim(ops_handover_comment) <> ''
         RETURNING id, ops_comment_reviewed, ops_comment_reviewed_at`,
        [reservationId, reviewed, req.user.id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Comment not found' });

      await logAudit({
        userId: req.user.id,
        action: reviewed ? 'OPS_COMMENT_REVIEWED' : 'OPS_COMMENT_UNREVIEWED',
        entityType: 'reservation',
        entityId: reservationId,
      });

      res.json({
        id: rows[0].id,
        reviewed: Number(rows[0].ops_comment_reviewed) === 1,
        reviewed_at: rows[0].ops_comment_reviewed_at,
      });
    } catch (e) {
      next(e);
    }
  }
);

function mapCheckout(row) {
  const insurance = Math.round((Number(row.insurance) || 0) * 100) / 100;
  const refundStatus = String(row.insurance_refund_status || '').toLowerCase();
  const refunded = ['refunded', 'partial', 'forfeited'].includes(refundStatus);
  return {
    id: row.id,
    guest_name: row.guest_name,
    guest_phone: row.guest_phone,
    check_in: row.check_in,
    check_out: row.check_out,
    status: row.status,
    unit_id: row.unit_id,
    unit_number: row.unit_number,
    unit_title: row.unit_title,
    project: row.project,
    insurance,
    insurance_refund_status: refunded ? refundStatus : insurance > 0.009 ? 'pending' : 'none',
    insurance_refunded_amount: Number(row.insurance_refunded_amount) || 0,
    insurance_damage_amount: Number(row.insurance_damage_amount) || 0,
    insurance_refunded_at: row.insurance_refunded_at,
    insurance_refund_method: row.insurance_refund_method,
    insurance_refunded_by_name: row.insurance_refunded_by_name || null,
    can_refund_insurance: insurance > 0.009 && !refunded,
  };
}

router.get('/ops/checkouts-today', requireRoles(...OPS_ROLES), async (req, res, next) => {
  try {
    const { range, from, to } = parseOpsDateRange(req.query.range || req.query.period);
    const params = [from, to];
    let scope = '';
    if (req.user.role === OPS_AGENT) {
      params.push(req.user.id);
      scope = ` AND r.ops_assigned_to = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT r.id,
              r.guest_name,
              r.guest_phone,
              r.check_in,
              r.check_out,
              r.status,
              r.unit_id,
              r.ops_assigned_to,
              COALESCE(r.insurance, 0)::float AS insurance,
              r.insurance_refund_status,
              COALESCE(r.insurance_refunded_amount, 0)::float AS insurance_refunded_amount,
              COALESCE(r.insurance_damage_amount, 0)::float AS insurance_damage_amount,
              r.insurance_refunded_at,
              r.insurance_refund_method,
              u.unit_number,
              COALESCE(u.unit_number, u.title, 'Unit') AS unit_title,
              COALESCE(u.project, u.compound) AS project,
              refunded_by.full_name AS insurance_refunded_by_name
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       LEFT JOIN staff_users refunded_by ON refunded_by.id = r.insurance_refunded_by
       WHERE r.check_out::date >= $1::date
         AND r.check_out::date <= $2::date
         AND r.status IS DISTINCT FROM 'cancelled'
         ${scope}
       ORDER BY r.check_out ASC, u.unit_number ASC NULLS LAST`,
      params
    );
    res.json({ range, from, to, items: rows.map(mapCheckout) });
  } catch (e) {
    next(e);
  }
});

router.post(
  '/ops/checkouts-today/:reservationId/refund-insurance',
  requireRoles(...OPS_ROLES),
  async (req, res, next) => {
    try {
      const reservationId = Number(req.params.reservationId);
      if (!reservationId) return res.status(400).json({ error: 'Invalid reservation id' });

      const { rows } = await query(
        `SELECT r.id,
                r.guest_name,
                r.guest_phone,
                r.check_in,
                r.check_out,
                r.status,
                r.unit_id,
                r.ops_assigned_to,
                COALESCE(r.insurance, 0)::float AS insurance,
                r.insurance_refund_status,
                COALESCE(r.insurance_refunded_amount, 0)::float AS insurance_refunded_amount,
                COALESCE(r.insurance_damage_amount, 0)::float AS insurance_damage_amount,
                r.insurance_refunded_at,
                r.insurance_refund_method,
                u.unit_number,
                COALESCE(u.unit_number, u.title, 'Unit') AS unit_title,
                COALESCE(u.project, u.compound) AS project,
                refunded_by.full_name AS insurance_refunded_by_name
         FROM reservations r
         JOIN units u ON u.id = r.unit_id
         LEFT JOIN staff_users refunded_by ON refunded_by.id = r.insurance_refunded_by
         WHERE r.id = $1`,
        [reservationId]
      );
      const row = rows[0];
      if (!row) return res.status(404).json({ error: 'Reservation not found' });
      if (String(row.status).toLowerCase() === 'cancelled') {
        return res.status(409).json({ error: 'Reservation is cancelled' });
      }
      const denied = assertOpsCanAct(req, row);
      if (denied) return res.status(403).json({ error: denied });

      const held = Math.round((Number(row.insurance) || 0) * 100) / 100;
      if (!(held > 0.009)) {
        return res.status(400).json({ error: 'This reservation has no insurance to refund' });
      }

      const existing = String(row.insurance_refund_status || '').toLowerCase();
      if (['refunded', 'partial', 'forfeited'].includes(existing)) {
        return res.json(mapCheckout(row));
      }

      let method = String(req.body?.payment_method || 'cash').toLowerCase();
      if (!['cash', 'instapay', 'bank_transfer'].includes(method)) method = 'cash';

      let refunded =
        req.body?.refunded_amount != null && req.body.refunded_amount !== ''
          ? Math.round((Number(req.body.refunded_amount) || 0) * 100) / 100
          : held;
      let damage =
        req.body?.damage_amount != null && req.body.damage_amount !== ''
          ? Math.round((Number(req.body.damage_amount) || 0) * 100) / 100
          : Math.round((held - refunded) * 100) / 100;

      if (!(refunded >= 0) || !(damage >= 0)) {
        return res.status(400).json({ error: 'refunded_amount and damage_amount must be non-negative' });
      }
      if (Math.abs(Math.round((refunded + damage) * 100) / 100 - held) > 0.05) {
        return res.status(400).json({
          error: `Refunded + damage must equal insurance held (EGP ${held.toFixed(2)})`,
        });
      }

      let status = 'refunded';
      if (damage > 0.009 && refunded > 0.009) status = 'partial';
      else if (damage > 0.009 && !(refunded > 0.009)) status = 'forfeited';

      const notes = req.body?.notes
        ? String(req.body.notes).slice(0, 2000)
        : `[ops checkout] Insurance payout by ${req.user.full_name || req.user.username || req.user.id}`;

      const refundDate = row.check_out
        ? String(row.check_out).slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      const { rows: updated } = await query(
        `UPDATE reservations SET
           insurance_refund_status = $2,
           insurance_refunded_amount = $3,
           insurance_damage_amount = $4,
           insurance_refunded_at = $5::date,
           insurance_refund_method = $6,
           insurance_refund_notes = $7,
           insurance_refunded_by = $8,
           updated_at = now()
         WHERE id = $1
         RETURNING id`,
        [reservationId, status, refunded, damage, refundDate, method, notes, req.user.id]
      );

      if (!updated[0]) return res.status(404).json({ error: 'Reservation not found' });

      await logAudit({
        userId: req.user.id,
        action: 'OPS_REFUND_INSURANCE',
        entityType: 'reservation',
        entityId: reservationId,
        details: {
          amount: refunded,
          damage_amount: damage,
          status,
          payment_method: method,
        },
      });

      const { rows: refreshed } = await query(
        `SELECT r.id,
                r.guest_name,
                r.guest_phone,
                r.check_in,
                r.check_out,
                r.status,
                r.unit_id,
                COALESCE(r.insurance, 0)::float AS insurance,
                r.insurance_refund_status,
                COALESCE(r.insurance_refunded_amount, 0)::float AS insurance_refunded_amount,
                COALESCE(r.insurance_damage_amount, 0)::float AS insurance_damage_amount,
                r.insurance_refunded_at,
                r.insurance_refund_method,
                u.unit_number,
                COALESCE(u.unit_number, u.title, 'Unit') AS unit_title,
                COALESCE(u.project, u.compound) AS project,
                refunded_by.full_name AS insurance_refunded_by_name
         FROM reservations r
         JOIN units u ON u.id = r.unit_id
         LEFT JOIN staff_users refunded_by ON refunded_by.id = r.insurance_refunded_by
         WHERE r.id = $1`,
        [reservationId]
      );
      res.json(mapCheckout(refreshed[0]));
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;
