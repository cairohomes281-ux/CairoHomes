require('dotenv').config({ path: '.env' });
const XLSX = require('xlsx');
const { query, pool } = require('../src/config/db');
const { resolveSalesLabel, matchSalesLabelToStaff } = require('../src/lib/salesNameMatch');
const { canonicalOpsAgentFromLabel, matchOpsStaff } = require('../src/lib/opsAgentAliases');
const { paymentStatusFrom } = require('../src/lib/syncReservationPayment');
const { syncBlocksForReservation } = require('../src/lib/reservationBlocks');

const FILE = process.argv.find((a) => /\.xlsx?$/i.test(a));
if (!FILE) {
  console.error('Usage: node scripts/import_reservations_xlsx.js <reservations.xlsx> [--dry-run]');
  process.exit(1);
}

/** Spreadsheet typos → inventory unit_number */
const UNIT_ALIASES = {
  'CL3-TW-16B': 'CL3-TW16-B',
};

function resolveUnitNumber(raw, unitByNumber) {
  const key = String(raw || '').trim().toUpperCase();
  if (!key) return null;
  const alias = UNIT_ALIASES[key] || key;
  return unitByNumber.get(alias) ? alias : key;
}

function excelDate(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
  return d.toISOString().slice(0, 10);
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function nightsBetween(checkIn, checkOut) {
  const a = new Date(`${checkIn}T00:00:00`);
  const b = new Date(`${checkOut}T00:00:00`);
  return Math.max(1, Math.round((b - a) / 86400000));
}

function normalizePaymentMethod(raw) {
  const s = String(raw || '').toLowerCase();
  if (!s || s === '0') return null;
  if (s.includes('instapay')) return 'instapay';
  if (s.includes('cash')) return 'cash';
  if (s.includes('card') || s.includes('paymob')) return 'paymob_card';
  if (s.includes('bank')) return 'bank_transfer';
  return 'cash';
}

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.length >= 8 ? digits : null;
}

function isOwnerRow(row) {
  const source = String(row.Source || '').trim().toLowerCase();
  const guest = String(row['Client Name'] || '').trim().toLowerCase();
  const sales = String(row['Sales Name'] || '').trim().toLowerCase();
  return source === 'owner' || guest === 'owner' || sales === 'owner';
}

function computeTotal(row, nights) {
  const sheetTotal = num(row['Total Reservation']);
  if (sheetTotal > 0) return Math.round(sheetTotal * 100) / 100;
  if (sheetTotal < 0) return Math.round(sheetTotal * 100) / 100;

  const nightly = num(row['Price per Night']);
  const stay = nightly > 0 ? nightly * nights : 0;
  const hk = num(row.Housekeeping);
  const beach = num(row['Beach Pass Total']);
  const util = num(row.Utilites);
  const ins = num(row.Insurance);
  const service = stay > 0 ? Math.round(stay * 0.15) : 0;
  const computed = stay + hk + beach + util + ins + service;
  return computed > 0 ? Math.round(computed * 100) / 100 : 0;
}

function parseRow(row) {
  const checkIn = excelDate(row['Check in']);
  const checkOut = excelDate(row['Check out']);
  const unitNumber = String(row['Unit No.'] || '').trim();
  if (!checkIn || !checkOut || !unitNumber) return { error: 'Missing dates or unit' };

  const nights = nightsBetween(checkIn, checkOut);
  const owner = isOwnerRow(row);
  const total = computeTotal(row, nights);
  const down = num(row['Down Payment']);
  const amountPaid = down > 0 ? down : num(row['Amount to pay']) > 0 ? num(row['Amount to pay']) : 0;
  const nightly = num(row['Price per Night']);
  const pricePerNight =
    nightly > 0 ? nightly : nights > 0 && total > 0 ? Math.round((total / nights) * 100) / 100 : 0;

  return {
    checkIn,
    checkOut,
    nights,
    unitNumber,
    guestName: String(row['Client Name'] || '').trim() || (owner ? 'Owner' : 'Guest'),
    guestPhone: normalizePhone(row['Mobile No.']),
    total,
    amountPaid,
    downPayment: down,
    pricePerNight,
    housekeeping: num(row.Housekeeping),
    beachAccess: num(row['Beach Pass Total']),
    utilities: num(row.Utilites),
    insurance: num(row.Insurance),
    paymentMethod: normalizePaymentMethod(row['Payment Method']),
    bookingSource: String(row.Source || '').trim() || null,
    salesLabel: resolveSalesLabel(row['Sales Name'] || row.Source || ''),
    owner,
    status: owner && total === 0 ? 'confirmed' : owner ? 'confirmed' : 'pending',
    paymentStatus:
      owner && total === 0
        ? 'paid'
        : paymentStatusFrom(total, amountPaid),
  };
}

(async () => {
  const dryRun = process.argv.includes('--dry-run');
  const wb = XLSX.readFile(FILE);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });

  const { rows: units } = await query(`SELECT id, unit_number, wp_post_id FROM units`);
  const unitByNumber = new Map(units.map((u) => [String(u.unit_number || '').trim().toUpperCase(), u]));

  const { rows: staff } = await query(
    `SELECT id, full_name, role FROM staff_users WHERE is_active = 1`
  );
  const { rows: admins } = await query(
    `SELECT id FROM staff_users WHERE role = 'admin' AND is_active = 1 ORDER BY id LIMIT 1`
  );
  const createdBy = admins[0]?.id || staff[0]?.id;

  const { rows: opsStaff } = await query(
    `SELECT id, full_name, role FROM staff_users
     WHERE is_active = 1 AND role IN ('operations', 'operations_supervisor')`
  );

  const results = { inserted: 0, skipped: 0, errors: [], duplicates: [] };

  for (let i = 0; i < rows.length; i++) {
    const parsed = parseRow(rows[i]);
    if (parsed.error) {
      results.errors.push({ row: i + 2, error: parsed.error });
      continue;
    }

    const unitKey = resolveUnitNumber(parsed.unitNumber, unitByNumber);
    const unit = unitByNumber.get(unitKey);
    if (!unit) {
      results.errors.push({ row: i + 2, unit: parsed.unitNumber, error: 'Unit not found' });
      continue;
    }

    const { rows: existing } = await query(
      `SELECT id FROM reservations
       WHERE unit_id = $1 AND check_in = $2 AND check_out = $3
         AND lower(btrim(guest_name)) = lower(btrim($4))
         AND status <> 'cancelled'
       LIMIT 1`,
      [unit.id, parsed.checkIn, parsed.checkOut, parsed.guestName]
    );
    if (existing[0]) {
      results.duplicates.push({
        row: i + 2,
        id: existing[0].id,
        unit: parsed.unitNumber,
        guest: parsed.guestName,
        checkIn: parsed.checkIn,
      });
      results.skipped++;
      continue;
    }

    const salesMatch = parsed.owner
      ? null
      : matchSalesLabelToStaff(parsed.salesLabel, staff)?.staff || null;
    const salesPersonId = salesMatch?.id || null;

    let opsAssigneeId = null;
    const canonical = canonicalOpsAgentFromLabel(parsed.salesLabel);
    if (canonical) {
      const hit = matchOpsStaff(canonical, opsStaff);
      if (hit) opsAssigneeId = hit.id;
    }

    if (dryRun) {
      console.log(
        `[dry-run row ${i + 2}] ${parsed.unitNumber} ${parsed.checkIn}→${parsed.checkOut} ${parsed.guestName} total=${parsed.total} paid=${parsed.amountPaid} sales=${parsed.salesLabel}`
      );
      results.inserted++;
      continue;
    }

    const { rows: inserted } = await query(
      `INSERT INTO reservations (
         unit_id, guest_name, guest_phone, check_in, check_out, nights,
         total_amount, amount_paid, payment_status, booking_source, sales_person_id,
         is_owner_reservation, status, created_by, price_per_night, housekeeping_fees,
         insurance, down_payment, utilities_amount, payment_method, sales_label,
         beach_access_fees, ops_assigned_to, ops_assigned_at, ops_assigned_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
         CASE WHEN $23::int IS NOT NULL THEN now() ELSE NULL END,
         CASE WHEN $23::int IS NOT NULL THEN $14::int ELSE NULL END
       )
       RETURNING id`,
      [
        unit.id,
        parsed.guestName,
        parsed.guestPhone,
        parsed.checkIn,
        parsed.checkOut,
        parsed.nights,
        parsed.total,
        parsed.amountPaid,
        parsed.paymentStatus,
        parsed.bookingSource,
        salesPersonId,
        parsed.owner ? 1 : 0,
        parsed.status,
        createdBy,
        parsed.pricePerNight,
        parsed.housekeeping,
        parsed.insurance,
        parsed.downPayment,
        parsed.utilities,
        parsed.paymentMethod,
        parsed.salesLabel,
        parsed.beachAccess,
        opsAssigneeId,
      ]
    );

    try {
      const { rows: full } = await query(`SELECT * FROM reservations WHERE id = $1`, [
        inserted[0].id,
      ]);
      await syncBlocksForReservation(full[0]);
    } catch (e) {
      results.errors.push({ row: i + 2, id: inserted[0].id, error: `Block sync: ${e.message}` });
    }

    results.inserted++;
  }

  console.log(JSON.stringify(results, null, 2));
  await pool.end();
})().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
