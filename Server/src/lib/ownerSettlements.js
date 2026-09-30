const { query } = require('../config/db');
const { calcReservationFinancials, calcStatementFinancials, round2 } = require('./commission');
const { FINANCIAL_EPOCH, clampFromDate } = require('./financialEpoch');


async function generateOwnerSettlement({ ownerId, periodStart, periodEnd }) {
  const from = clampFromDate(periodStart);
  const to = periodEnd;
  const { rows: links } = await query(`SELECT unit_id FROM owner_units WHERE owner_id = $1`, [
    ownerId,
  ]);
  const unitIds = links.map((r) => r.unit_id);
  if (!unitIds.length) {
    throw Object.assign(new Error('Owner has no linked units'), { status: 400 });
  }

  const { rows: reservations } = await query(
    `SELECT r.*, u.company_commission_pct, u.company_commission_owner_pct,
            u.commission_mode, u.commission_tenant_pct, u.utilities_cost, u.id AS unit_row_id
     FROM reservations r
     JOIN units u ON u.id = r.unit_id
     WHERE r.unit_id = ANY($1::uuid[])
       AND r.status <> 'cancelled'
       AND r.check_in >= $2::date
       AND r.check_in <= $3::date`,
    [unitIds, from, to]
  );

  let gross = 0;
  let commission = 0;
  let net = 0;
  for (const r of reservations) {
    const utilitiesAmount =
      parseFloat(r.utilities_amount) ||
      (Number(r.nights) || 0) * (parseFloat(r.utilities_cost) || 0);
    const fin = calcReservationFinancials(r, { ...r, utilities_amount: utilitiesAmount });
    gross += fin.grossAmount;
    commission += fin.companyCommission;
    net += fin.ownerNet;
  }

  
  const { rows: expRows } = await query(
    `SELECT COALESCE(SUM(amount), 0)::float AS total
     FROM expenses
     WHERE paid_by = 'owner'
       AND expense_date >= $2::date
       AND expense_date <= $3::date
       AND (
         owner_id = $4
         OR (owner_id IS NULL AND unit_id = ANY($1::uuid[]))
       )`,
    [unitIds, from, to, ownerId]
  );
  const ownerExpenses = Number(expRows[0]?.total) || 0;
  net = round2(net - ownerExpenses);
  gross = round2(gross);
  commission = round2(commission);

  const { rows: existing } = await query(
    `SELECT id FROM owner_settlements
     WHERE owner_id = $1 AND period_start = $2::date AND period_end = $3::date
       AND status IN ('open','ready')
     LIMIT 1`,
    [ownerId, from, to]
  );

  if (existing[0]) {
    const { rows } = await query(
      `UPDATE owner_settlements SET
         gross_amount = $1,
         commission_amount = $2,
         net_amount = $3,
         updated_at = now()
       WHERE id = $4
       RETURNING *`,
      [gross, commission, net, existing[0].id]
    );
    return rows[0];
  }

  const { rows } = await query(
    `INSERT INTO owner_settlements (
       owner_id, period_start, period_end, gross_amount, commission_amount, net_amount, status, notes
     ) VALUES ($1,$2,$3,$4,$5,$6,'open',$7)
     RETURNING *`,
    [
      ownerId,
      from,
      to,
      gross,
      commission,
      net,
      `Auto-generated from ${reservations.length} reservations; owner expenses ${ownerExpenses}`,
    ]
  );
  return rows[0];
}

module.exports = { generateOwnerSettlement, calcStatementFinancials };
