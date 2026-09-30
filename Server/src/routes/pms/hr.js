const express = require('express');
const XLSX = require('xlsx');
const { query, pool } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { excelUpload } = require('../../config/cloudinary');
const {
  dailyRate,
  computeLatenessDeduction,
  computeAbsenceDeduction,
  computeHalfDayDeduction,
  cairoParts,
  PAID_EXCUSE_MAX_PER_MONTH,
  PAID_EXCUSE_MAX_HOURS,
  canRequestHolidays,
  leaveTypeRequiresHolidayAccess,
  leaveTypeRequiresApproval,
  leaveApprovalPolicy,
  leaveTypeApprovalMode,
  leaveDayDeductionAmount,
  enumerateDateRange,
  computeUnpaidLeaveDeduction,
  computeUnpaidExcuseDeduction,
  isExcuseLeaveType,
  leaveDoesNotAffectAttendance,
  normalizeExcuseLeaveType,
  assertExcuseWindow,
  assertMissionWindow,
  hourlyRate,
  monthsBetween,
  HR_TEAM_ROLES,
  assertCanEditStaffCompensation,
  nextPayrollPeriod,
  dateCoveredByRanges,
  parseAttendanceRows,
  parseHtmlExcelTables,
  collapsePunchAttendance,
  fillMissingOfficeAbsences,
  isDoorPunchLog,
  normalizePersonId,
  matchAttendanceStaff,
  assertOriginalRecordsAttendanceTemplate,
  roundMoney,
  splitSalaryAdjustments,
  hasOfficeAttendance,
  isFieldOperationsRole,
  canRequestWfh,
  canRequestStaffBenefits,
  canRequestLoan,
  staffRequestPolicy,
  wfhRequestPolicy,
  loanRequestPolicy,
  canViewAllStaffRequests,
  canSeeRequestHistory,
  eligibleReviewSlots,
  applyRequestReview,
  describeRequestApproval,
  isUnpaidLeaveUnlimited,
} = require('../../lib/hrRules');
const { loadManagerIds, sqlStaffManagedBy } = require('../../lib/staffManagers');

const router = express.Router();

const HR_ROLES = ['admin', ...HR_TEAM_ROLES];

function isHrActor(user) {
  return user && (user.role === 'admin' || HR_TEAM_ROLES.includes(user.role));
}

function assertCanTargetBenefits(staff) {
  if (!canRequestStaffBenefits(staff?.role)) {
    const err = new Error('Admins do not request holidays or work-from-home days');
    err.status = 403;
    throw err;
  }
}

function assertCanTargetLoan(staff) {
  if (!canRequestLoan(staff?.role)) {
    const err = new Error('This account cannot request loans');
    err.status = 403;
    throw err;
  }
}

function requestListScope(actor, { mine, alias = 'r', staffAlias = 'u', kind, history = false } = {}) {
  const params = [];
  const where = [];
  const wantMine = mine === '1' || mine === 1 || mine === true;
  const wantHistory = history === true || history === '1' || history === 1;
  // CEO (and HR/HR Manager in history mode) list every request. Managers see self + direct reports.
  if (wantMine || !canViewAllStaffRequests(actor, { history: wantHistory })) {
    params.push(actor.id);
    const me = `$${params.length}`;
    if (wantMine) {
      where.push(`${alias}.staff_user_id = ${me}`);
    } else {
      const parts = [`${alias}.staff_user_id = ${me}`, sqlStaffManagedBy(me, staffAlias)];
      // HR Manager sees pending items that still need HR (including while waiting on manager/finance).
      if (!wantHistory && actor.role === 'hr_supervisor') {
        parts.push(`(
          ${alias}.status = 'pending'
          AND COALESCE(${alias}.needs_hr_approval, true) = true
          AND ${alias}.hr_reviewed_by IS NULL
        )`);
      }
      // Financial Manager sees all pending loans so they can tell where each one is waiting.
      if (!wantHistory && actor.role === 'finance_manager' && kind === 'loan') {
        parts.push(`${alias}.status = 'pending'`);
      }
      where.push(`(${parts.join(' OR ')})`);
    }
  }
  return { params, where };
}

function presentStaffRequest(row, actor, kind = null) {
  const managerIds = Array.isArray(row.manager_ids)
    ? row.manager_ids.map(Number).filter((id) => Number.isFinite(id))
    : row.manager_id != null
      ? [Number(row.manager_id)]
      : [];
  const staff = {
    id: row.staff_user_id,
    role: row.role,
    manager_id: row.manager_id,
    manager_ids: managerIds,
  };
  const requestKind =
    kind ||
    (row.leave_type != null ? 'leave' : row.work_date != null ? 'wfh' : row.amount != null ? 'loan' : null);
  const shaped = {
    ...row,
    manager_ids: managerIds,
    request_kind: requestKind,
    approval_mode:
      row.approval_mode ||
      (row.leave_type ? leaveTypeApprovalMode(row.leave_type) : 'all'),
  };
  return {
    ...shaped,
    can_review_slots: eligibleReviewSlots(actor, shaped, staff),
    approval_label: describeRequestApproval(shaped),
  };
}

const REQUEST_LIST_JOINS = `
      JOIN staff_users u ON u.id = r.staff_user_id
      LEFT JOIN staff_users mgr ON mgr.id = u.manager_id
      LEFT JOIN staff_users reviewer ON reviewer.id = r.reviewed_by
      LEFT JOIN staff_users mgr_rev ON mgr_rev.id = r.manager_reviewed_by
      LEFT JOIN staff_users hr_rev ON hr_rev.id = r.hr_reviewed_by
`;

const LOAN_LIST_JOINS = `
      ${REQUEST_LIST_JOINS}
      LEFT JOIN staff_users fin_rev ON fin_rev.id = r.finance_reviewed_by
`;

const REQUEST_LIST_SELECT = `
      r.*,
      u.full_name,
      u.role,
      u.staff_code,
      u.manager_id,
      COALESCE(
        (SELECT array_agg(sm.manager_id ORDER BY sm.manager_id)
         FROM staff_user_managers sm
         WHERE sm.staff_user_id = u.id),
        ARRAY[]::int[]
      ) AS manager_ids,
      mgr.full_name AS manager_name,
      reviewer.full_name AS reviewed_by_name,
      mgr_rev.full_name AS manager_reviewed_by_name,
      hr_rev.full_name AS hr_reviewed_by_name
`;

const LOAN_LIST_SELECT = `
      ${REQUEST_LIST_SELECT},
      fin_rev.full_name AS finance_reviewed_by_name
`;

async function listStaffRequests(req, table) {
  const status = String(req.query.status || '').toLowerCase();
  const kind =
    table === 'staff_loan_requests' ? 'loan' : table === 'staff_wfh_requests' ? 'wfh' : 'leave';
  const history = req.query.history === '1' || req.query.history === 1 || req.query.history === true;
  const { params, where } = requestListScope(req.user, { mine: req.query.mine, kind, history });
  if (['pending', 'approved', 'rejected'].includes(status)) {
    params.push(status);
    where.push(`r.status = $${params.length}`);
  }
  const isLoan = table === 'staff_loan_requests';
  const { rows } = await query(
    `SELECT ${isLoan ? LOAN_LIST_SELECT : REQUEST_LIST_SELECT}
     FROM ${table} r
     ${isLoan ? LOAN_LIST_JOINS : REQUEST_LIST_JOINS}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC
     LIMIT 500`,
    params
  );
  return rows.map((row) => presentStaffRequest(row, req.user, kind));
}

async function reviewStaffRequest({ table, id, actor, body, onApprove }) {
  const status = String(body?.status || '').toLowerCase();
  const note = body?.review_note ? String(body.review_note).slice(0, 500) : null;
  const kind =
    table === 'staff_loan_requests' ? 'loan' : table === 'staff_wfh_requests' ? 'wfh' : 'leave';
  const isLoan = table === 'staff_loan_requests';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: existingRows } = await client.query(
      `SELECT r.*, u.role, u.manager_id, u.base_salary, u.full_name,
              COALESCE(
                (SELECT array_agg(sm.manager_id ORDER BY sm.manager_id)
                 FROM staff_user_managers sm
                 WHERE sm.staff_user_id = u.id),
                ARRAY[]::int[]
              ) AS manager_ids
       FROM ${table} r
       JOIN staff_users u ON u.id = r.staff_user_id
       WHERE r.id = $1
       FOR UPDATE OF r`,
      [id]
    );
    const row = existingRows[0];
    if (!row || row.status !== 'pending') {
      await client.query('ROLLBACK');
      const err = new Error('Pending request not found');
      err.status = 404;
      throw err;
    }
    const staff = {
      id: row.staff_user_id,
      role: row.role,
      manager_id: row.manager_id,
      manager_ids: Array.isArray(row.manager_ids)
        ? row.manager_ids.map(Number).filter((id) => Number.isFinite(id))
        : await loadManagerIds(row.staff_user_id),
      base_salary: row.base_salary,
      full_name: row.full_name,
    };
    const next = applyRequestReview({ ...row, request_kind: kind }, actor, status, staff);
    const extra = {};
    if (next.finalized && next.status === 'approved' && onApprove) {
      const fromApprove = await onApprove(client, row, staff);
      if (fromApprove && typeof fromApprove === 'object') {
        Object.assign(extra, fromApprove);
      }
    }
    const managerJustSet = next.manager_reviewed_by && !row.manager_reviewed_by;
    const hrJustSet = next.hr_reviewed_by && !row.hr_reviewed_by;
    const financeJustSet =
      isLoan && next.finance_reviewed_by && !row.finance_reviewed_by;
    const extraCols = Object.keys(extra);
    let sql;
    let params;
    if (isLoan) {
      sql = `UPDATE ${table} SET
         status = $1,
         reviewed_by = $2,
         reviewed_at = now(),
         review_note = COALESCE($3, review_note),
         manager_reviewed_by = $4,
         manager_reviewed_at = CASE WHEN $5 THEN now() ELSE manager_reviewed_at END,
         hr_reviewed_by = $6,
         hr_reviewed_at = CASE WHEN $7 THEN now() ELSE hr_reviewed_at END,
         finance_reviewed_by = $8,
         finance_reviewed_at = CASE WHEN $9 THEN now() ELSE finance_reviewed_at END
         ${extraCols.length ? `, ${extraCols.map((col, i) => `${col} = $${10 + i}`).join(', ')}` : ''}
       WHERE id = $${10 + extraCols.length}
       RETURNING *`;
      params = [
        next.status,
        actor.id,
        note,
        next.manager_reviewed_by,
        managerJustSet,
        next.hr_reviewed_by,
        hrJustSet,
        next.finance_reviewed_by,
        financeJustSet,
        ...extraCols.map((col) => extra[col]),
        id,
      ];
    } else {
      sql = `UPDATE ${table} SET
         status = $1,
         reviewed_by = $2,
         reviewed_at = now(),
         review_note = COALESCE($3, review_note),
         manager_reviewed_by = $4,
         manager_reviewed_at = CASE WHEN $5 THEN now() ELSE manager_reviewed_at END,
         hr_reviewed_by = $6,
         hr_reviewed_at = CASE WHEN $7 THEN now() ELSE hr_reviewed_at END
         ${extraCols.length ? `, ${extraCols.map((col, i) => `${col} = $${8 + i}`).join(', ')}` : ''}
       WHERE id = $${8 + extraCols.length}
       RETURNING *`;
      params = [
        next.status,
        actor.id,
        note,
        next.manager_reviewed_by,
        managerJustSet,
        next.hr_reviewed_by,
        hrJustSet,
        ...extraCols.map((col) => extra[col]),
        id,
      ];
    }
    const { rows } = await client.query(sql, params);
    await client.query('COMMIT');
    return presentStaffRequest(
      {
        ...rows[0],
        role: staff.role,
        manager_id: staff.manager_id,
        full_name: staff.full_name,
      },
      actor,
      kind
    );
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

function inclusiveDays(start, end) {
  const a = new Date(`${start}T00:00:00`);
  const b = new Date(`${end}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return NaN;
  return Math.round((b - a) / 86400000) + 1;
}

function periodBounds(year, month) {
  const y = Number(year);
  const m = Number(month);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { from, to: next };
}

function parsePeriod(req) {
  const now = new Date();
  const year = Number(req.query.year || req.body?.year) || now.getFullYear();
  const month = Number(req.query.month || req.body?.month) || now.getMonth() + 1;
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    const err = new Error('Invalid year');
    err.status = 400;
    throw err;
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    const err = new Error('Invalid month');
    err.status = 400;
    throw err;
  }
  return { year, month, ...periodBounds(year, month) };
}

async function loadStaffForHr(staffUserId) {
  const { rows } = await query(
    `SELECT id, role, full_name, staff_code, base_salary, created_at, manager_id,
            COALESCE(leave_casual_days, 0)::int AS leave_casual_days,
            COALESCE(leave_annual_days, 0)::int AS leave_annual_days,
            COALESCE(leave_unpaid_days, 0)::int AS leave_unpaid_days,
            COALESCE(holiday_access, 'auto') AS holiday_access,
            COALESCE(office_attendance_exempt, false) AS office_attendance_exempt
     FROM staff_users WHERE id = $1`,
    [staffUserId]
  );
  if (!rows[0] || rows[0].role === 'owner') {
    const err = new Error('Staff member not found');
    err.status = 404;
    throw err;
  }
  return rows[0];
}

async function pendingLeaveDays(staffUserId, leaveType, exceptId = null) {
  const params = [staffUserId, leaveType];
  let sql = `SELECT COALESCE(SUM(days), 0)::int AS days
             FROM staff_leave_requests
             WHERE staff_user_id = $1 AND leave_type = $2 AND status = 'pending'`;
  if (exceptId) {
    params.push(exceptId);
    sql += ` AND id <> $3`;
  }
  const { rows } = await query(sql, params);
  return Number(rows[0]?.days) || 0;
}

async function paidExcuseUsedInMonth(staffUserId, yearMonth) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS cnt
     FROM staff_leave_requests
     WHERE staff_user_id = $1
       AND leave_type IN ('paid_excuse', 'early_leave')
       AND status IN ('pending', 'approved')
       AND to_char(start_date, 'YYYY-MM') = $2`,
    [staffUserId, yearMonth]
  );
  return Number(rows[0]?.cnt) || 0;
}

async function leaveSnapshot(staffUserId) {
  const staff = await loadStaffForHr(staffUserId);
  const cairo = cairoParts();
  const year = Number(cairo.date.slice(0, 4));
  const yearMonth = cairo.date.slice(0, 7);
  const pendingCasual = await pendingLeaveDays(staffUserId, 'casual');
  const pendingAnnual = await pendingLeaveDays(staffUserId, 'annual');
  const paidExcuseUsed = await paidExcuseUsedInMonth(staffUserId, yearMonth);
  const unpaidUnlimited = isUnpaidLeaveUnlimited();
  const rateDaily = dailyRate(staff.base_salary);
  const rateHourly = hourlyRate(staff.base_salary);
  return {
    staff_user_id: staff.id,
    full_name: staff.full_name,
    base_salary: Number(staff.base_salary) || 0,
    daily_rate: rateDaily,
    hourly_rate: rateHourly,
    casual_balance: Number(staff.leave_casual_days) || 0,
    annual_balance: Number(staff.leave_annual_days) || 0,
    unpaid_balance: unpaidUnlimited ? null : Number(staff.leave_unpaid_days) || 0,
    casual_available: Math.max(0, (Number(staff.leave_casual_days) || 0) - pendingCasual),
    annual_available: Math.max(0, (Number(staff.leave_annual_days) || 0) - pendingAnnual),
    unpaid_available: unpaidUnlimited
      ? null
      : Math.max(0, (Number(staff.leave_unpaid_days) || 0) - (await pendingLeaveDays(staffUserId, 'unpaid'))),
    unpaid_unlimited: unpaidUnlimited,
    paid_excuse_used: paidExcuseUsed,
    paid_excuse_remaining: Math.max(0, PAID_EXCUSE_MAX_PER_MONTH - paidExcuseUsed),
    paid_excuse_max: PAID_EXCUSE_MAX_PER_MONTH,
    paid_excuse_max_hours: PAID_EXCUSE_MAX_HOURS,
    // Back-compat for older clients
    early_leave_used: paidExcuseUsed,
    early_leave_remaining: Math.max(0, PAID_EXCUSE_MAX_PER_MONTH - paidExcuseUsed),
    early_leave_max: PAID_EXCUSE_MAX_PER_MONTH,
    year,
    month: yearMonth,
    holiday_access: staff.holiday_access || 'auto',
    can_request_holidays: canRequestHolidays(staff),
    tenure_months: monthsBetween(staff.created_at, new Date()),
  };
}

async function insertDeduction(db, values) {
  // staff_salary_deductions requires amount > 0; staff with no base salary compute to 0.
  if (!(Number(values[1]) > 0)) return null;
  const q = db ? (sql, params) => db.query(sql, params) : query;
  const { rows } = await q(
    `INSERT INTO staff_salary_deductions
       (staff_user_id, amount, reason, deduction_date, category, created_by,
        arrival_time, notified, daily_rate, days_factor)
     VALUES ($1,$2,$3,$4::date,$5,$6,NULLIF($7, '')::time,$8,$9,$10)
     RETURNING *`,
    values
  );
  return rows[0];
}

function cellKey(staffId, date) {
  return `${staffId}|${String(date).slice(0, 10)}`;
}

function hhMmOrNull(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const m = text.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${String(m[1]).padStart(2, '0')}:${m[2]}`;
}

function buildAttendanceWrite({ staff, date, status, checkIn, checkOut, amount, notified, actorId }) {
  const st = String(status || '').trim();
  if (!['on_time', 'late', 'no_show'].includes(st)) {
    const err = new Error('Status must be on time, late, or no show');
    err.status = 400;
    throw err;
  }
  const inTime = hhMmOrNull(checkIn);
  const outTime = hhMmOrNull(checkOut);
  if (st === 'late' && !inTime) {
    const err = new Error('Check-in time is required for a late day');
    err.status = 400;
    throw err;
  }

  let lateComputed = null;
  let absenceComputed = null;
  let deductionAmount = amount;
  if (deductionAmount == null || Number.isNaN(Number(deductionAmount))) {
    if (st === 'on_time') deductionAmount = 0;
    else if (st === 'late') {
      lateComputed = computeLatenessDeduction(staff.base_salary, inTime);
      deductionAmount = lateComputed.amount;
    } else {
      absenceComputed = computeAbsenceDeduction(staff.base_salary);
      deductionAmount = absenceComputed.amount;
    }
  }
  deductionAmount = roundMoney(Number(deductionAmount) || 0);
  if (deductionAmount < 0) deductionAmount = 0;

  if (st === 'late' && !lateComputed && inTime) {
    lateComputed = computeLatenessDeduction(staff.base_salary, inTime);
  }
  if (st === 'no_show' && !absenceComputed) {
    absenceComputed = computeAbsenceDeduction(staff.base_salary);
  }

  const notifiedFlag = st === 'no_show' ? !!notified : null;
  const cell = mapAttendanceRow({
    staff_user_id: staff.id,
    work_date: date,
    status: st,
    check_in: inTime,
    check_out: outTime,
    deduction_amount: deductionAmount,
    notified: st === 'no_show' ? !!notified : false,
  });

  let deduction = null;
  if (deductionAmount > 0 && st !== 'on_time') {
    if (st === 'late' && lateComputed) {
      deduction = {
        staff_user_id: staff.id,
        amount: deductionAmount,
        reason: `Lateness at ${inTime} (${lateComputed.label})`,
        deduction_date: date,
        category: 'lateness',
        created_by: actorId || null,
        arrival_time: inTime,
        notified: null,
        daily_rate: lateComputed.daily_rate,
        days_factor: lateComputed.factor,
      };
    } else if (absenceComputed) {
      deduction = {
        staff_user_id: staff.id,
        amount: deductionAmount,
        reason: absenceComputed.label,
        deduction_date: date,
        category: 'absence',
        created_by: actorId || null,
        arrival_time: null,
        notified: !!notified,
        daily_rate: absenceComputed.daily_rate,
        days_factor: absenceComputed.factor,
      };
    }
  }

  return {
    cell,
    attendance: {
      staff_user_id: staff.id,
      work_date: date,
      status: st,
      check_in: inTime,
      check_out: outTime,
      deduction_amount: deductionAmount,
      notified: notifiedFlag,
      created_by: actorId || null,
    },
    deduction,
  };
}

async function bulkWriteAttendance(writes) {
  if (!writes.length) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const staffIds = writes.map((w) => w.attendance.staff_user_id);
    const dates = writes.map((w) => w.attendance.work_date);
    await client.query(
      `DELETE FROM staff_salary_deductions d
       USING unnest($1::int[], $2::date[]) AS x(staff_user_id, deduction_date)
       WHERE d.staff_user_id = x.staff_user_id
         AND d.deduction_date = x.deduction_date
         AND d.category IN ('lateness', 'absence')`,
      [staffIds, dates]
    );
    await client.query(
      `INSERT INTO staff_attendance
         (staff_user_id, work_date, status, check_in, check_out, deduction_amount, notified, created_by, updated_at)
       SELECT t.staff_user_id, t.work_date::date, t.status,
              NULLIF(t.check_in, '')::time, NULLIF(t.check_out, '')::time,
              t.deduction_amount, t.notified, t.created_by, now()
       FROM unnest(
         $1::int[], $2::date[], $3::text[], $4::text[], $5::text[], $6::float8[], $7::boolean[], $8::int[]
       ) AS t(staff_user_id, work_date, status, check_in, check_out, deduction_amount, notified, created_by)
       ON CONFLICT (staff_user_id, work_date) DO UPDATE SET
         status = EXCLUDED.status,
         check_in = EXCLUDED.check_in,
         check_out = EXCLUDED.check_out,
         deduction_amount = EXCLUDED.deduction_amount,
         notified = EXCLUDED.notified,
         created_by = EXCLUDED.created_by,
         updated_at = now()`,
      [
        writes.map((w) => w.attendance.staff_user_id),
        writes.map((w) => w.attendance.work_date),
        writes.map((w) => w.attendance.status),
        writes.map((w) => w.attendance.check_in),
        writes.map((w) => w.attendance.check_out),
        writes.map((w) => w.attendance.deduction_amount),
        writes.map((w) => w.attendance.notified),
        writes.map((w) => w.attendance.created_by),
      ]
    );
    const deductions = writes.map((w) => w.deduction).filter(Boolean);
    if (deductions.length) {
      await client.query(
        `INSERT INTO staff_salary_deductions
           (staff_user_id, amount, reason, deduction_date, category, created_by,
            arrival_time, notified, daily_rate, days_factor)
         SELECT t.staff_user_id, t.amount, t.reason, t.deduction_date::date, t.category, t.created_by,
                NULLIF(t.arrival_time, '')::time, t.notified, t.daily_rate, t.days_factor
         FROM unnest(
           $1::int[], $2::float8[], $3::text[], $4::date[], $5::text[], $6::int[],
           $7::text[], $8::boolean[], $9::float8[], $10::float8[]
         ) AS t(staff_user_id, amount, reason, deduction_date, category, created_by,
                arrival_time, notified, daily_rate, days_factor)`,
        [
          deductions.map((d) => d.staff_user_id),
          deductions.map((d) => d.amount),
          deductions.map((d) => d.reason),
          deductions.map((d) => d.deduction_date),
          deductions.map((d) => d.category),
          deductions.map((d) => d.created_by),
          deductions.map((d) => d.arrival_time),
          deductions.map((d) => d.notified),
          deductions.map((d) => d.daily_rate),
          deductions.map((d) => d.days_factor),
        ]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

function mapAttendanceRow(row) {
  if (!row) return null;
  return {
    staff_user_id: row.staff_user_id,
    work_date: String(row.work_date || '').slice(0, 10),
    status: row.status,
    check_in: row.check_in || null,
    check_out: row.check_out || null,
    deduction_amount: Number(row.deduction_amount) || 0,
    notified: !!row.notified,
    notes: row.notes || '',
  };
}

function cellFromDeduction(row) {
  const category = String(row.category || '').toLowerCase();
  const status = category === 'absence' ? 'no_show' : 'late';
  return {
    staff_user_id: row.staff_user_id,
    work_date: String(row.deduction_date || '').slice(0, 10),
    status,
    check_in: row.arrival_time || null,
    check_out: null,
    deduction_amount: Number(row.amount) || 0,
    notified: !!row.notified,
    notes: row.reason || '',
    from_deduction: true,
  };
}

async function clearDayPenalties(staffId, date) {
  await query(
    `DELETE FROM staff_salary_deductions
     WHERE staff_user_id = $1
       AND deduction_date = $2::date
       AND category IN ('lateness', 'absence')`,
    [staffId, date]
  );
}

async function upsertAttendanceRecord({
  staff,
  date,
  status,
  checkIn,
  checkOut,
  amount,
  notified,
  actorId,
}) {
  const st = String(status || '').trim();
  if (!['on_time', 'late', 'no_show'].includes(st)) {
    const err = new Error('Status must be on time, late, or no show');
    err.status = 400;
    throw err;
  }
  const inTime = hhMmOrNull(checkIn);
  const outTime = hhMmOrNull(checkOut);
  if (st === 'late' && !inTime) {
    const err = new Error('Check-in time is required for a late day');
    err.status = 400;
    throw err;
  }

  let deductionAmount = amount;
  if (deductionAmount == null || Number.isNaN(Number(deductionAmount))) {
    if (st === 'on_time') deductionAmount = 0;
    else if (st === 'late') {
      deductionAmount = computeLatenessDeduction(staff.base_salary, inTime).amount;
    } else {
      deductionAmount = computeAbsenceDeduction(staff.base_salary).amount;
    }
  }
  deductionAmount = roundMoney(Number(deductionAmount) || 0);
  if (deductionAmount < 0) deductionAmount = 0;

  await query(
    `INSERT INTO staff_attendance
       (staff_user_id, work_date, status, check_in, check_out, deduction_amount, notified, created_by, updated_at)
     VALUES ($1,$2::date,$3,NULLIF($4, '')::time,NULLIF($5, '')::time,$6,$7,$8,now())
     ON CONFLICT (staff_user_id, work_date) DO UPDATE SET
       status = EXCLUDED.status,
       check_in = EXCLUDED.check_in,
       check_out = EXCLUDED.check_out,
       deduction_amount = EXCLUDED.deduction_amount,
       notified = EXCLUDED.notified,
       created_by = EXCLUDED.created_by,
       updated_at = now()`,
    [staff.id, date, st, inTime, outTime, deductionAmount, st === 'no_show' ? !!notified : null, actorId || null]
  );

  await clearDayPenalties(staff.id, date);
  if (deductionAmount > 0 && st !== 'on_time') {
    if (st === 'late') {
      const computed = computeLatenessDeduction(staff.base_salary, inTime);
      await insertDeduction(null, [
        staff.id,
        deductionAmount,
        `Lateness at ${inTime} (${computed.label})`,
        date,
        'lateness',
        actorId || null,
        inTime,
        null,
        computed.daily_rate,
        computed.factor,
      ]);
    } else {
      const computed = computeAbsenceDeduction(staff.base_salary);
      await insertDeduction(null, [
        staff.id,
        deductionAmount,
        computed.label,
        date,
        'absence',
        actorId || null,
        null,
        !!notified,
        computed.daily_rate,
        computed.factor,
      ]);
    }
  }

  return mapAttendanceRow({
    staff_user_id: staff.id,
    work_date: date,
    status: st,
    check_in: inTime,
    check_out: outTime,
    deduction_amount: deductionAmount,
    notified: st === 'no_show' ? !!notified : false,
  });
}

async function deleteAttendanceRecord(staffId, date) {
  await clearDayPenalties(staffId, date);
  await query(
    `DELETE FROM staff_attendance WHERE staff_user_id = $1 AND work_date = $2::date`,
    [staffId, date]
  );
}

function normalizeAttendanceHolidayType(value) {
  let nextType = normalizeExcuseLeaveType(String(value || '').trim());
  if (nextType === 'holiday') nextType = 'annual';
  if (nextType === 'day_off') nextType = 'casual';
  return nextType;
}

function isSingleDayLeave(row) {
  return String(row.start_date || '').slice(0, 10) === String(row.end_date || '').slice(0, 10);
}

async function loadCoveringAttendanceLeaves(staffId, date, db = null) {
  const q = db ? (sql, params) => db.query(sql, params) : query;
  const { rows } = await q(
    `SELECT id, staff_user_id, leave_type,
            start_date::text AS start_date, end_date::text AS end_date,
            COALESCE(days, 1)::float AS days
     FROM staff_leave_requests
     WHERE staff_user_id = $1 AND status = 'approved'
       AND start_date <= $2::date AND end_date >= $2::date`,
    [staffId, date]
  );
  return rows.filter((row) => !leaveDoesNotAffectAttendance(row.leave_type));
}

async function removeSingleDayLeavesForDate(db, staff, date) {
  const covering = await loadCoveringAttendanceLeaves(staff.id, date, db);
  for (const leave of covering) {
    if (!isSingleDayLeave(leave)) {
      const err = new Error(
        'This day is part of a multi-day holiday. Change or cancel that leave request first.'
      );
      err.status = 400;
      throw err;
    }
    await reverseLeaveTypeEffects(db, leave, staff.base_salary);
    await db.query(`DELETE FROM staff_leave_requests WHERE id = $1`, [leave.id]);
  }
}

async function reverseLeaveTypeEffects(db, row, baseSalary) {
  const q = db ? (sql, params) => db.query(sql, params) : query;
  let fromType = normalizeAttendanceHolidayType(row.leave_type);
  const days = Number(row.days) || inclusiveDays(row.start_date, row.end_date);
  const fromBalanceCol = balanceColumnForLeaveType(fromType);
  if (fromBalanceCol) {
    await q(
      `UPDATE staff_users SET ${fromBalanceCol} = ${fromBalanceCol} + $1, updated_at = now() WHERE id = $2`,
      [days, row.staff_user_id]
    );
  }
  if (fromType === 'unpaid') {
    await q(
      `DELETE FROM staff_salary_deductions
       WHERE staff_user_id = $1
         AND category = 'other'
         AND reason = 'Unpaid leave'
         AND deduction_date >= $2::date
         AND deduction_date <= $3::date`,
      [row.staff_user_id, row.start_date, row.end_date]
    );
  }
}

async function applyLeaveTypeEffects(db, { staffId, leaveType, days, startDate, endDate, baseSalary, actorId }) {
  const q = db ? (sql, params) => db.query(sql, params) : query;
  const toBalanceCol = balanceColumnForLeaveType(leaveType);
  if (toBalanceCol) {
    const { rows: balRows } = await q(
      `SELECT ${toBalanceCol} AS balance FROM staff_users WHERE id = $1 FOR UPDATE`,
      [staffId]
    );
    const balance = Number(balRows[0]?.balance) || 0;
    if (balance < days) {
      const err = new Error(`Not enough ${leaveType} balance (${balance} left, ${days} needed)`);
      err.status = 400;
      throw err;
    }
    await q(
      `UPDATE staff_users SET ${toBalanceCol} = ${toBalanceCol} - $1, updated_at = now() WHERE id = $2`,
      [days, staffId]
    );
  }
  if (leaveType === 'unpaid') {
    const unpaid = computeUnpaidLeaveDeduction(baseSalary);
    for (const date of enumerateDateRange(startDate, endDate)) {
      await insertDeduction(db, [
        staffId,
        unpaid.amount,
        'Unpaid leave',
        date,
        'other',
        actorId || null,
        null,
        null,
        unpaid.daily_rate,
        unpaid.factor,
      ]);
    }
  }
}

function holidayAttendanceCell(staff, date, leaveRow, baseSalary) {
  return {
    staff_user_id: staff.id,
    work_date: date,
    status: 'holiday',
    leave_type: leaveRow.leave_type,
    leave_request_id: leaveRow.id,
    start_date: String(leaveRow.start_date).slice(0, 10),
    end_date: String(leaveRow.end_date).slice(0, 10),
    check_in: null,
    check_out: null,
    deduction_amount: leaveDayDeductionAmount(leaveRow.leave_type, baseSalary),
    notified: false,
    notes: '',
  };
}

async function setAttendanceHolidayDay({ staff, date, leaveType, actorId }) {
  const nextType = normalizeAttendanceHolidayType(leaveType);
  if (!EDITABLE_FULL_DAY_LEAVE_TYPES.has(nextType)) {
    const err = new Error('Holiday type must be casual, annual, unpaid, or sick');
    err.status = 400;
    throw err;
  }

  const covering = await loadCoveringAttendanceLeaves(staff.id, date);
  const multi = covering.find((leave) => !isSingleDayLeave(leave));
  if (multi) {
    // Only type changes are allowed on multi-day leaves from attendance.
    if (normalizeAttendanceHolidayType(multi.leave_type) === nextType) {
      return holidayAttendanceCell(staff, date, multi, staff.base_salary);
    }
    const err = new Error(
      'This day is part of a multi-day holiday. Use the holiday type editor, or cancel the leave request first.'
    );
    err.status = 400;
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const leave of covering) {
      await reverseLeaveTypeEffects(client, leave, staff.base_salary);
      await client.query(`DELETE FROM staff_leave_requests WHERE id = $1`, [leave.id]);
    }
    await applyLeaveTypeEffects(client, {
      staffId: staff.id,
      leaveType: nextType,
      days: 1,
      startDate: date,
      endDate: date,
      baseSalary: staff.base_salary,
      actorId,
    });
    await client.query(
      `DELETE FROM staff_salary_deductions
       WHERE staff_user_id = $1
         AND deduction_date = $2::date
         AND category IN ('lateness', 'absence')`,
      [staff.id, date]
    );
    await client.query(
      `DELETE FROM staff_attendance WHERE staff_user_id = $1 AND work_date = $2::date`,
      [staff.id, date]
    );
    const { rows } = await client.query(
      `INSERT INTO staff_leave_requests
         (staff_user_id, leave_type, start_date, end_date, days, reason, status,
          needs_manager_approval, needs_hr_approval,
          manager_reviewed_by, manager_reviewed_at,
          hr_reviewed_by, hr_reviewed_at,
          reviewed_by, reviewed_at, review_note)
       VALUES ($1,$2,$3::date,$3::date,1,$4,'approved',
               false,false,
               $5,now(),
               $5,now(),
               $5,now(),$6)
       RETURNING id, leave_type, start_date::text AS start_date, end_date::text AS end_date`,
      [
        staff.id,
        nextType,
        date,
        'Marked from attendance',
        actorId || null,
        `Attendance holiday · ${nextType}`,
      ]
    );
    await client.query('COMMIT');
    return holidayAttendanceCell(staff, date, rows[0], staff.base_salary);
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

router.get('/hr/payroll', requireRoles(...HR_ROLES), async (req, res, next) => {
  try {
    const { year, month, from, to } = parsePeriod(req);
    const { rows } = await query(
      `SELECT
         u.id AS staff_user_id,
         u.full_name,
         u.role,
         u.staff_code,
         u.is_active,
         COALESCE(u.base_salary, 0)::float AS live_base_salary,
         COALESCE(d.deductions, 0)::float AS live_deductions,
         COALESCE(b.bonuses, 0)::float AS live_bonuses,
         p.id AS payroll_id,
         p.base_salary::float AS paid_base_salary,
         p.deductions::float AS paid_deductions,
         COALESCE(p.bonuses, 0)::float AS paid_bonuses,
         p.net_pay::float AS paid_net_pay,
         p.status AS payroll_status,
         p.paid_at,
         p.notes,
         payer.full_name AS paid_by_name
       FROM staff_users u
       LEFT JOIN (
         SELECT staff_user_id, SUM(amount)::float AS deductions
         FROM staff_salary_deductions
         WHERE deduction_date >= $1::date AND deduction_date < $2::date
         GROUP BY staff_user_id
       ) d ON d.staff_user_id = u.id
       LEFT JOIN (
         SELECT staff_user_id, SUM(amount)::float AS bonuses
         FROM staff_salary_bonuses
         WHERE bonus_date >= $1::date AND bonus_date < $2::date
         GROUP BY staff_user_id
       ) b ON b.staff_user_id = u.id
       LEFT JOIN staff_payroll_entries p
         ON p.staff_user_id = u.id AND p.period_year = $3 AND p.period_month = $4
       LEFT JOIN staff_users payer ON payer.id = p.paid_by
       WHERE u.role <> 'owner'
       ORDER BY u.full_name`,
      [from, to, year, month]
    );

    const staff = rows.map((r) => {
      const paid = r.payroll_status === 'paid';
      const base = paid ? Number(r.paid_base_salary) : Number(r.live_base_salary) || 0;
      const deductions = paid ? Number(r.paid_deductions) : Number(r.live_deductions) || 0;
      const bonuses = paid ? Number(r.paid_bonuses) : Number(r.live_bonuses) || 0;
      const net = paid ? Number(r.paid_net_pay) : Math.max(0, roundMoney(base + bonuses - deductions));
      return {
        staff_user_id: r.staff_user_id,
        full_name: r.full_name,
        role: r.role,
        staff_code: r.staff_code,
        is_active: r.is_active,
        base_salary: base,
        bonuses,
        deductions,
        net_pay: net,
        live_deductions: Number(r.live_deductions) || 0,
        live_bonuses: Number(r.live_bonuses) || 0,
        status: paid ? 'paid' : 'unpaid',
        paid_at: r.paid_at,
        paid_by_name: r.paid_by_name,
        notes: r.notes,
        payroll_id: r.payroll_id,
      };
    });

    const active = staff.filter((s) => Number(s.is_active) === 1);
    const visible = req.query.include_inactive === '1' ? staff : active;
    const totals = visible.reduce(
      (acc, s) => {
        acc.base += s.base_salary;
        acc.bonuses += s.bonuses;
        acc.deductions += s.deductions;
        acc.net += s.net_pay;
        if (s.status === 'paid') acc.paid += s.net_pay;
        else acc.unpaid += s.net_pay;
        return acc;
      },
      { base: 0, bonuses: 0, deductions: 0, net: 0, paid: 0, unpaid: 0 }
    );

    res.json({ year, month, from, to, totals, staff: visible });
  } catch (e) {
    next(e);
  }
});

router.post('/hr/payroll/mark-paid', requireRoles(...HR_ROLES), async (req, res, next) => {
  try {
    const { year, month, from, to } = parsePeriod(req);
    const ids = Array.isArray(req.body?.staff_user_ids)
      ? req.body.staff_user_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : [];
    const notes = req.body?.notes ? String(req.body.notes).slice(0, 500) : null;

    const { rows: staffRows } = await query(
      `SELECT
         u.id,
         u.full_name,
         u.staff_code,
         COALESCE(u.base_salary, 0)::float AS base_salary,
         COALESCE(d.deductions, 0)::float AS deductions,
         COALESCE(b.bonuses, 0)::float AS bonuses
       FROM staff_users u
       LEFT JOIN (
         SELECT staff_user_id, SUM(amount)::float AS deductions
         FROM staff_salary_deductions
         WHERE deduction_date >= $1::date AND deduction_date < $2::date
         GROUP BY staff_user_id
       ) d ON d.staff_user_id = u.id
       LEFT JOIN (
         SELECT staff_user_id, SUM(amount)::float AS bonuses
         FROM staff_salary_bonuses
         WHERE bonus_date >= $1::date AND bonus_date < $2::date
         GROUP BY staff_user_id
       ) b ON b.staff_user_id = u.id
       WHERE u.role <> 'owner'
         AND u.is_active = 1
         ${ids.length ? `AND u.id = ANY($3::int[])` : ''}`,
      ids.length ? [from, to, ids] : [from, to]
    );

    if (!staffRows.length) {
      return res.status(400).json({ error: 'No matching staff to pay for this period' });
    }

    const paid = [];
    const expenses = [];
    const { postExpenseForPayrollEntry } = require('../../jobs/monthlySalaryExpenses');

    for (const row of staffRows) {
      const base = Number(row.base_salary) || 0;
      const deductions = Number(row.deductions) || 0;
      const bonuses = Number(row.bonuses) || 0;
      const net = Math.max(0, roundMoney(base + bonuses - deductions));
      const { rows } = await query(
        `INSERT INTO staff_payroll_entries (
           staff_user_id, period_year, period_month, base_salary, deductions, bonuses, net_pay,
           status, paid_at, paid_by, notes
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'paid', now(), $8, $9)
         ON CONFLICT (staff_user_id, period_year, period_month)
         DO UPDATE SET
           base_salary = EXCLUDED.base_salary,
           deductions = EXCLUDED.deductions,
           bonuses = EXCLUDED.bonuses,
           net_pay = EXCLUDED.net_pay,
           status = 'paid',
           paid_at = now(),
           paid_by = EXCLUDED.paid_by,
           notes = COALESCE(EXCLUDED.notes, staff_payroll_entries.notes)
         RETURNING *`,
        [row.id, year, month, base, deductions, bonuses, net, req.user.id, notes]
      );
      paid.push(rows[0]);

      const staffName = row.full_name || row.staff_code || `Staff #${row.id}`;
      try {
        const exp = await postExpenseForPayrollEntry(rows[0], {
          staffName,
          createdBy: req.user.id,
        });
        expenses.push(exp);
      } catch (expErr) {
        console.error('[hr/payroll] salary expense post failed', expErr.message);
        expenses.push({ action: 'error', staff_id: row.id, error: expErr.message });
      }
    }

    res.json({ ok: true, year, month, count: paid.length, entries: paid, expenses });
  } catch (e) {
    next(e);
  }
});

router.get('/hr/my-leave', async (req, res, next) => {
  try {
    if (req.user.role === 'owner') {
      return res.status(403).json({ error: 'Owner accounts do not have staff leave' });
    }
    res.json(await leaveSnapshot(req.user.id));
  } catch (e) {
    next(e);
  }
});

router.get('/hr/payslip', async (req, res, next) => {
  try {
    if (req.user.role === 'owner') {
      return res.status(403).json({ error: 'Owner accounts do not have a staff payslip' });
    }
    const { year, month, from, to } = parsePeriod(req);
    let staffUserId = req.user.id;
    if (isHrActor(req.user) && req.query.staff_user_id) {
      staffUserId = Number(req.query.staff_user_id);
    }
    const staff = await loadStaffForHr(staffUserId);
    if (!isHrActor(req.user) && staffUserId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { rows: deductionRows } = await query(
      `SELECT id, amount, reason, deduction_date, category, arrival_time, notified, daily_rate, days_factor
       FROM staff_salary_deductions
       WHERE staff_user_id = $1 AND deduction_date >= $2::date AND deduction_date < $3::date
       ORDER BY deduction_date, id`,
      [staffUserId, from, to]
    );
    const { rows: bonusRows } = await query(
      `SELECT id, amount, reason, bonus_date
       FROM staff_salary_bonuses
       WHERE staff_user_id = $1 AND bonus_date >= $2::date AND bonus_date < $3::date
       ORDER BY bonus_date, id`,
      [staffUserId, from, to]
    );
    const { rows: payrollRows } = await query(
      `SELECT * FROM staff_payroll_entries
       WHERE staff_user_id = $1 AND period_year = $2 AND period_month = $3`,
      [staffUserId, year, month]
    );
    const payroll = payrollRows[0] || null;
    const paid = payroll?.status === 'paid';
    const split = splitSalaryAdjustments(deductionRows);
    const liveBonuses = roundMoney(bonusRows.reduce((acc, r) => acc + (Number(r.amount) || 0), 0));
    const liveDebits = roundMoney(split.penalties_total + split.deductions_total);
    const base = paid ? Number(payroll.base_salary) || 0 : Number(staff.base_salary) || 0;
    const bonuses = paid ? Number(payroll.bonuses) || liveBonuses : liveBonuses;
    const debits = paid ? Number(payroll.deductions) || liveDebits : liveDebits;
    const net = paid
      ? Number(payroll.net_pay) || 0
      : Math.max(0, roundMoney(base + bonuses - liveDebits));

    res.json({
      year,
      month,
      from,
      to,
      staff_user_id: staff.id,
      full_name: staff.full_name,
      staff_code: staff.staff_code || null,
      role: staff.role,
      daily_rate: dailyRate(staff.base_salary),
      status: paid ? 'paid' : 'unpaid',
      paid_at: payroll?.paid_at || null,
      notes: payroll?.notes || null,
      base_salary: base,
      bonuses,
      penalties: split.penalties_total,
      deductions: split.deductions_total,
      debits,
      net_pay: net,
      bonus_items: bonusRows,
      penalty_items: split.penalties,
      deduction_items: split.deductions,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/hr/salary-bonuses', requireRoles(...HR_ROLES), async (req, res, next) => {
  try {
    const staffId = req.query.staff_user_id ? Number(req.query.staff_user_id) : null;
    const params = [];
    let filter = '';
    if (staffId) {
      params.push(staffId);
      filter = `WHERE b.staff_user_id = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT b.*,
              u.full_name,
              u.role,
              u.staff_code,
              creator.full_name AS created_by_name
       FROM staff_salary_bonuses b
       JOIN staff_users u ON u.id = b.staff_user_id
       LEFT JOIN staff_users creator ON creator.id = b.created_by
       ${filter}
       ORDER BY b.bonus_date DESC, b.id DESC
       LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/hr/salary-bonuses', requireRoles(...HR_ROLES), async (req, res, next) => {
  try {
    const b = req.body || {};
    const staffUserId = Number(b.staff_user_id);
    const bonusDate = String(b.bonus_date || b.deduction_date || '').slice(0, 10);
    const amount = parseFloat(b.amount);
    const reason = String(b.reason || '').trim();
    if (!staffUserId || !bonusDate) {
      return res.status(400).json({ error: 'Staff and date are required' });
    }
    if (Number.isNaN(amount) || amount <= 0 || !reason) {
      return res.status(400).json({ error: 'Amount and reason are required' });
    }
    await loadStaffForHr(staffUserId);
    const { rows } = await query(
      `INSERT INTO staff_salary_bonuses (staff_user_id, amount, reason, bonus_date, created_by)
       VALUES ($1,$2,$3,$4::date,$5)
       RETURNING *`,
      [staffUserId, amount, reason.slice(0, 255), bonusDate, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.delete('/hr/salary-bonuses/:id', requireRoles(...HR_ROLES), async (req, res, next) => {
  try {
    const { rowCount } = await query(`DELETE FROM staff_salary_bonuses WHERE id = $1`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Bonus not found' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get('/hr/salary-deductions', requireRoles(...HR_ROLES), async (req, res, next) => {
  try {
    const staffId = req.query.staff_user_id ? Number(req.query.staff_user_id) : null;
    const params = [];
    let filter = '';
    if (staffId) {
      params.push(staffId);
      filter = `WHERE d.staff_user_id = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT d.*,
              u.full_name,
              u.role,
              u.staff_code,
              creator.full_name AS created_by_name
       FROM staff_salary_deductions d
       JOIN staff_users u ON u.id = d.staff_user_id
       LEFT JOIN staff_users creator ON creator.id = d.created_by
       ${filter}
       ORDER BY d.deduction_date DESC, d.id DESC
       LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/hr/salary-deductions', requireRoles(...HR_ROLES), async (req, res, next) => {
  try {
    const b = req.body || {};
    const staffUserId = Number(b.staff_user_id);
    const deductionDate = String(b.deduction_date || '').slice(0, 10);
    let category = String(b.category || b.kind || 'other').trim() || 'other';
    if (category === 'delay') category = 'other';
    const allowed = new Set(['performance', 'advance', 'other', 'penalty']);
    if (!staffUserId || !deductionDate) {
      return res.status(400).json({ error: 'Staff and date are required' });
    }
    if (!allowed.has(category)) {
      return res.status(400).json({ error: 'Invalid deduction category' });
    }

    const staff = await loadStaffForHr(staffUserId);
    if (staff.role === 'admin') {
      return res.status(403).json({ error: 'Admins do not have salary deductions' });
    }
    let amount;
    let reason = String(b.reason || '').trim();
    let arrivalTime = null;
    let notified = null;
    let rate = dailyRate(staff.base_salary);
    let factor = null;

    amount = parseFloat(b.amount);
    if (Number.isNaN(amount) || amount <= 0 || !reason) {
      return res.status(400).json({ error: 'Amount and reason are required' });
    }

    const { rows } = await query(
      `INSERT INTO staff_salary_deductions
         (staff_user_id, amount, reason, deduction_date, category, created_by,
          arrival_time, notified, daily_rate, days_factor)
       VALUES ($1,$2,$3,$4::date,$5,$6,NULLIF($7, '')::time,$8,$9,$10)
       RETURNING *`,
      [
        staffUserId,
        amount,
        reason,
        deductionDate,
        category,
        req.user.id,
        arrivalTime,
        notified,
        rate,
        factor,
      ]
    );
    res.status(201).json({ ...rows[0], daily_rate: rate, days_factor: factor });
  } catch (e) {
    next(e);
  }
});

router.put('/hr/salary-deductions/:id', requireRoles('admin', 'hr', 'hr_supervisor'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const { rows: existing } = await query(
      `SELECT id, category FROM staff_salary_deductions WHERE id = $1`,
      [req.params.id]
    );
    if (!existing[0]) return res.status(404).json({ error: 'Deduction not found' });

    const deductionDate = String(b.deduction_date || '').slice(0, 10);
    const amount = parseFloat(b.amount);
    const reason = String(b.reason || '').trim();
    if (!deductionDate) return res.status(400).json({ error: 'Date is required' });
    if (Number.isNaN(amount) || amount <= 0 || !reason) {
      return res.status(400).json({ error: 'Amount and reason are required' });
    }

    const manual = new Set(['performance', 'advance', 'other', 'penalty']);
    let category = existing[0].category;
    const requested = String(b.category || '').trim();
    if (requested && requested !== category) {
      if (!manual.has(category) || !manual.has(requested)) {
        return res.status(400).json({ error: 'This deduction type cannot be changed' });
      }
      category = requested;
    }

    const { rows } = await query(
      `UPDATE staff_salary_deductions
         SET amount = $2, reason = $3, deduction_date = $4::date, category = $5
       WHERE id = $1
       RETURNING *`,
      [req.params.id, amount, reason, deductionDate, category]
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.delete('/hr/salary-deductions/:id', requireRoles(...HR_ROLES), async (req, res, next) => {
  try {
    const { rowCount } = await query(`DELETE FROM staff_salary_deductions WHERE id = $1`, [
      req.params.id,
    ]);
    if (!rowCount) return res.status(404).json({ error: 'Deduction not found' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get('/hr/requests-history', async (req, res, next) => {
  try {
    if (!canSeeRequestHistory(req.user)) {
      return res.status(403).json({ error: 'You cannot view request history' });
    }
    const status = String(req.query.status || 'all').toLowerCase();
    const kindFilter = String(req.query.kind || 'all').toLowerCase();
    const historyReq = { ...req, query: { ...req.query, history: '1', mine: undefined } };

    const loads = [];
    if (kindFilter === 'all' || kindFilter === 'holiday' || kindFilter === 'leave') {
      loads.push(
        listStaffRequests(
          { ...historyReq, query: { ...historyReq.query, status: status === 'all' ? undefined : status } },
          'staff_leave_requests'
        ).then((rows) => rows.map((r) => ({ ...r, history_kind: 'holiday' })))
      );
    }
    if (kindFilter === 'all' || kindFilter === 'wfh') {
      loads.push(
        listStaffRequests(
          { ...historyReq, query: { ...historyReq.query, status: status === 'all' ? undefined : status } },
          'staff_wfh_requests'
        ).then((rows) => rows.map((r) => ({ ...r, history_kind: 'wfh' })))
      );
    }
    if (kindFilter === 'all' || kindFilter === 'loans' || kindFilter === 'loan') {
      loads.push(
        listStaffRequests(
          { ...historyReq, query: { ...historyReq.query, status: status === 'all' ? undefined : status } },
          'staff_loan_requests'
        ).then((rows) => rows.map((r) => ({ ...r, history_kind: 'loan' })))
      );
    }

    const groups = await Promise.all(loads);
    const items = groups
      .flat()
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      .slice(0, 500);

    res.json({ items });
  } catch (e) {
    next(e);
  }
});

router.get('/hr/leave-requests', async (req, res, next) => {
  try {
    res.json(await listStaffRequests(req, 'staff_leave_requests'));
  } catch (e) {
    next(e);
  }
});

router.post('/hr/leave-requests', async (req, res, next) => {
  try {
    if (req.user.role === 'admin') {
      return res.status(403).json({ error: 'Admins do not request holidays' });
    }
    const b = req.body || {};
    let leaveType = normalizeExcuseLeaveType(String(b.leave_type || 'casual').trim() || 'casual');
    if (leaveType === 'holiday') leaveType = 'annual';
    if (leaveType === 'day_off') leaveType = 'casual';
    const start = String(b.start_date || '').slice(0, 10);
    const end = String(b.end_date || start).slice(0, 10);
    const reason = String(b.reason || '').trim();
    const allowed = new Set([
      'casual',
      'annual',
      'paid_excuse',
      'unpaid_excuse',
      'sick',
      'unpaid',
      'mission',
    ]);
    if (!allowed.has(leaveType)) {
      return res.status(400).json({ error: 'Invalid leave type' });
    }
    const isExcuse = isExcuseLeaveType(leaveType);
    const isMission = leaveType === 'mission';
    const isTimed = isExcuse || isMission;
    const days = isTimed ? 1 : inclusiveDays(start, end);
    if (!start || !end || !Number.isFinite(days) || days < 1) {
      return res.status(400).json({ error: 'Valid start and end dates are required' });
    }
    if (isTimed && start !== end) {
      return res.status(400).json({
        error: isMission ? 'Missions are for a single day' : 'Excuses are for a single day',
      });
    }
    if (isMission && !reason) {
      return res.status(400).json({ error: 'A note is required for mission requests' });
    }

    let excuseWindow = null;
    if (isExcuse) {
      excuseWindow = assertExcuseWindow(leaveType, b.start_time, b.end_time);
    } else if (isMission) {
      excuseWindow = assertMissionWindow(b.start_time, b.end_time);
    }

    let staffUserId = req.user.id;
    if (isHrActor(req.user) && b.staff_user_id) {
      staffUserId = Number(b.staff_user_id);
    }
    if (req.user.role === 'owner') {
      return res.status(403).json({ error: 'Owner accounts cannot request staff holidays' });
    }

    const targetStaff = await loadStaffForHr(staffUserId);
    assertCanTargetBenefits(targetStaff);
    if (leaveTypeRequiresHolidayAccess(leaveType) && !canRequestHolidays(targetStaff)) {
      return res.status(403).json({
        error:
          'Paid holiday requests are not enabled for this account yet. Access opens automatically after 6 months, or HR can grant it earlier. Unpaid leave, excuses, and missions can be requested now.',
      });
    }

    const snap = await leaveSnapshot(staffUserId);
    if (leaveType === 'casual' && days > snap.casual_available) {
      return res.status(400).json({
        error: `Not enough casual leave (${snap.casual_available} day${snap.casual_available === 1 ? '' : 's'} left)`,
      });
    }
    if (leaveType === 'annual' && days > snap.annual_available) {
      return res.status(400).json({
        error: `Not enough annual leave (${snap.annual_available} day${snap.annual_available === 1 ? '' : 's'} left)`,
      });
    }
    if (leaveType === 'paid_excuse' && snap.paid_excuse_remaining < 1) {
      return res.status(400).json({
        error: `Paid excuse limit reached (maximum ${PAID_EXCUSE_MAX_PER_MONTH} per month)`,
      });
    }

    const policy = leaveApprovalPolicy(leaveType, targetStaff.role);
    if (!policy.canRequest) {
      return res.status(403).json({ error: 'This role cannot request holidays' });
    }
    const client = await pool.connect();
    let created;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO staff_leave_requests
           (staff_user_id, leave_type, start_date, end_date, days, reason, status,
            needs_manager_approval, needs_hr_approval, start_time, end_time, hours)
         VALUES ($1,$2,$3::date,$4::date,$5,$6,'pending',$7,$8,$9::time,$10::time,$11)
         RETURNING *`,
        [
          staffUserId,
          leaveType,
          start,
          isTimed ? start : end,
          days,
          reason || null,
          policy.needsManager,
          policy.needsHr,
          excuseWindow?.start_time || null,
          excuseWindow?.end_time || null,
          excuseWindow?.hours ?? null,
        ]
      );
      created = rows[0];
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.status(201).json(
      presentStaffRequest(
        {
          ...created,
          full_name: targetStaff.full_name,
          role: targetStaff.role,
          staff_code: targetStaff.staff_code,
          manager_id: targetStaff.manager_id,
          approval_mode: policy.approvalMode,
        },
        req.user
      )
    );
  } catch (e) {
    next(e);
  }
});

router.post('/hr/leave-requests/:id/review', async (req, res, next) => {
  try {
    const updated = await reviewStaffRequest({
      table: 'staff_leave_requests',
      id: req.params.id,
      actor: req.user,
      body: req.body,
      onApprove: async (client, row, staff) => {
        if (row.leave_type === 'casual' || row.leave_type === 'annual') {
          const col = row.leave_type === 'casual' ? 'leave_casual_days' : 'leave_annual_days';
          const { rows: staffRows } = await client.query(
            `SELECT ${col} AS balance FROM staff_users WHERE id = $1 FOR UPDATE`,
            [row.staff_user_id]
          );
          const balance = Number(staffRows[0]?.balance) || 0;
          if (balance < Number(row.days)) {
            const err = new Error(
              `Not enough ${row.leave_type} balance to approve (${balance} left, ${row.days} needed)`
            );
            err.status = 400;
            throw err;
          }
          await client.query(
            `UPDATE staff_users SET ${col} = ${col} - $1, updated_at = now() WHERE id = $2`,
            [row.days, row.staff_user_id]
          );
        }
        if (row.leave_type === 'unpaid') {
          const unpaid = computeUnpaidLeaveDeduction(staff.base_salary);
          for (const date of enumerateDateRange(row.start_date, row.end_date)) {
            await insertDeduction(client, [
              row.staff_user_id,
              unpaid.amount,
              'Unpaid leave',
              date,
              'other',
              req.user.id,
              null,
              null,
              unpaid.daily_rate,
              unpaid.factor,
            ]);
          }
        }
        if (row.leave_type === 'unpaid_excuse') {
          const hours = Number(row.hours) || 0;
          const unpaid = computeUnpaidExcuseDeduction(staff.base_salary, hours);
          if (unpaid.amount > 0) {
            await insertDeduction(client, [
              row.staff_user_id,
              unpaid.amount,
              `Unpaid excuse (${row.start_time || ''}–${row.end_time || ''}, ${hours}h)`,
              row.start_date,
              'other',
              req.user.id,
              null,
              null,
              unpaid.daily_rate,
              unpaid.hours,
            ]);
          }
        }
        if (row.leave_type === 'paid_excuse' || row.leave_type === 'early_leave') {
          const yearMonth = String(row.start_date).slice(0, 7);
          const { rows: usedRows } = await client.query(
            `SELECT COUNT(*)::int AS cnt
             FROM staff_leave_requests
             WHERE staff_user_id = $1
               AND leave_type IN ('paid_excuse', 'early_leave')
               AND status = 'approved'
               AND to_char(start_date, 'YYYY-MM') = $2
               AND id <> $3`,
            [row.staff_user_id, yearMonth, row.id]
          );
          const used = Number(usedRows[0]?.cnt) || 0;
          if (used + 1 > PAID_EXCUSE_MAX_PER_MONTH) {
            const err = new Error(
              `Paid excuse limit reached (maximum ${PAID_EXCUSE_MAX_PER_MONTH} per month)`
            );
            err.status = 400;
            throw err;
          }
        }
      },
    });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

const EDITABLE_FULL_DAY_LEAVE_TYPES = new Set(['casual', 'annual', 'unpaid', 'sick']);

function balanceColumnForLeaveType(leaveType) {
  if (leaveType === 'casual') return 'leave_casual_days';
  if (leaveType === 'annual') return 'leave_annual_days';
  return null;
}

/**
 * Change leave_type on an approved full-day holiday (e.g. unpaid → casual/annual).
 * Reverses/applies balance debits and unpaid salary deductions for the whole request range.
 */
router.patch('/hr/leave-requests/:id/type', requireRoles(...HR_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    let nextType = normalizeExcuseLeaveType(String(req.body?.leave_type || '').trim());
    if (nextType === 'holiday') nextType = 'annual';
    if (nextType === 'day_off') nextType = 'casual';
    if (!EDITABLE_FULL_DAY_LEAVE_TYPES.has(nextType)) {
      return res.status(400).json({
        error: 'Holiday type must be casual, annual, unpaid, or sick',
      });
    }
    if (isExcuseLeaveType(nextType)) {
      return res.status(400).json({ error: 'Cannot convert a full-day holiday into an excuse' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT r.*, u.role, u.manager_id, u.base_salary, u.full_name,
                u.leave_casual_days, u.leave_annual_days,
                COALESCE(
                  (SELECT array_agg(sm.manager_id ORDER BY sm.manager_id)
                   FROM staff_user_managers sm
                   WHERE sm.staff_user_id = u.id),
                  ARRAY[]::int[]
                ) AS manager_ids
         FROM staff_leave_requests r
         JOIN staff_users u ON u.id = r.staff_user_id
         WHERE r.id = $1
         FOR UPDATE OF r, u`,
        [id]
      );
      const row = rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Leave request not found' });
      }
      if (row.status !== 'approved') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Only approved holidays can change type here' });
      }
      if (isExcuseLeaveType(row.leave_type)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Excuses cannot be edited from the attendance holiday cell' });
      }

      let fromType = normalizeExcuseLeaveType(row.leave_type);
      if (fromType === 'holiday') fromType = 'annual';
      if (fromType === 'day_off') fromType = 'casual';
      if (fromType === nextType) {
        await client.query('COMMIT');
        return res.json(
          presentStaffRequest(
            {
              ...row,
              role: row.role,
              manager_id: row.manager_id,
              full_name: row.full_name,
            },
            req.user,
            'leave'
          )
        );
      }

      const days = Number(row.days) || inclusiveDays(row.start_date, row.end_date);

      const fromBalanceCol = balanceColumnForLeaveType(fromType);
      const toBalanceCol = balanceColumnForLeaveType(nextType);

      // Restore balance if leaving a paid balance type.
      if (fromBalanceCol) {
        await client.query(
          `UPDATE staff_users SET ${fromBalanceCol} = ${fromBalanceCol} + $1, updated_at = now() WHERE id = $2`,
          [days, row.staff_user_id]
        );
      }
      // Remove unpaid leave deductions for this range.
      if (fromType === 'unpaid') {
        await client.query(
          `DELETE FROM staff_salary_deductions
           WHERE staff_user_id = $1
             AND category = 'other'
             AND reason = 'Unpaid leave'
             AND deduction_date >= $2::date
             AND deduction_date <= $3::date`,
          [row.staff_user_id, row.start_date, row.end_date]
        );
      }

      // Debit new paid balance type.
      if (toBalanceCol) {
        const { rows: balRows } = await client.query(
          `SELECT ${toBalanceCol} AS balance FROM staff_users WHERE id = $1 FOR UPDATE`,
          [row.staff_user_id]
        );
        const balance = Number(balRows[0]?.balance) || 0;
        if (balance < days) {
          const err = new Error(
            `Not enough ${nextType} balance (${balance} left, ${days} needed)`
          );
          err.status = 400;
          throw err;
        }
        await client.query(
          `UPDATE staff_users SET ${toBalanceCol} = ${toBalanceCol} - $1, updated_at = now() WHERE id = $2`,
          [days, row.staff_user_id]
        );
      }
      // Add unpaid deductions for the range.
      if (nextType === 'unpaid') {
        const unpaid = computeUnpaidLeaveDeduction(row.base_salary);
        for (const date of enumerateDateRange(row.start_date, row.end_date)) {
          await insertDeduction(client, [
            row.staff_user_id,
            unpaid.amount,
            'Unpaid leave',
            date,
            'other',
            req.user.id,
            null,
            null,
            unpaid.daily_rate,
            unpaid.factor,
          ]);
        }
      }

      const { rows: updatedRows } = await client.query(
        `UPDATE staff_leave_requests
         SET leave_type = $2,
             review_note = COALESCE($3, review_note),
             reviewed_by = $4,
             reviewed_at = now()
         WHERE id = $1
         RETURNING *`,
        [
          id,
          nextType,
          req.body?.review_note
            ? String(req.body.review_note).slice(0, 500)
            : `Type changed from ${fromType} to ${nextType}`,
          req.user.id,
        ]
      );
      await client.query('COMMIT');

      res.json(
        presentStaffRequest(
          {
            ...updatedRows[0],
            role: row.role,
            manager_id: row.manager_id,
            full_name: row.full_name,
            manager_ids: row.manager_ids,
          },
          req.user,
          'leave'
        )
      );
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    next(e);
  }
});

router.get('/hr/loans', async (req, res, next) => {
  try {
    if (req.user.role === 'owner') return res.status(403).json({ error: 'Forbidden' });
    res.json(await listStaffRequests(req, 'staff_loan_requests'));
  } catch (e) {
    next(e);
  }
});

router.post('/hr/loans', async (req, res, next) => {
  try {
    const amount = parseFloat(req.body?.amount);
    const reason = String(req.body?.reason || '').trim();
    if (!(amount > 0) || !reason) {
      return res.status(400).json({ error: 'Amount and reason are required' });
    }
    let staffUserId = req.user.id;
    if (isHrActor(req.user) && req.body?.staff_user_id) {
      staffUserId = Number(req.body.staff_user_id);
    }
    const target = await loadStaffForHr(staffUserId);
    assertCanTargetLoan(target);
    const policy = loanRequestPolicy(target.role);
    const { rows } = await query(
      `INSERT INTO staff_loan_requests
         (staff_user_id, amount, reason, status, needs_manager_approval, needs_finance_approval, needs_hr_approval)
       VALUES ($1,$2,$3,'pending',$4,$5,$6)
       RETURNING *`,
      [staffUserId, amount, reason, policy.needsManager, policy.needsFinance, policy.needsHr]
    );
    res.status(201).json(
      presentStaffRequest(
        {
          ...rows[0],
          full_name: target.full_name,
          role: target.role,
          staff_code: target.staff_code,
          manager_id: target.manager_id,
        },
        req.user,
        'loan'
      )
    );
  } catch (e) {
    next(e);
  }
});

router.post('/hr/loans/:id/review', async (req, res, next) => {
  try {
    const updated = await reviewStaffRequest({
      table: 'staff_loan_requests',
      id: req.params.id,
      actor: req.user,
      body: req.body,
      onApprove: async (client, row, staff) => {
        const next = nextPayrollPeriod(cairoParts().date);
        const inserted = await insertDeduction(client, [
          row.staff_user_id,
          row.amount,
          String(row.reason || 'Salary loan').slice(0, 255),
          next.deductionDate,
          'loan',
          req.user.id,
          null,
          null,
          dailyRate(staff.base_salary),
          null,
        ]);
        return {
          deduct_year: next.year,
          deduct_month: next.month,
          deduction_id: inserted?.id ?? null,
        };
      },
    });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

router.get('/hr/wfh', async (req, res, next) => {
  try {
    if (req.user.role === 'owner') return res.status(403).json({ error: 'Forbidden' });
    res.json(await listStaffRequests(req, 'staff_wfh_requests'));
  } catch (e) {
    next(e);
  }
});

router.post('/hr/wfh', async (req, res, next) => {
  try {
    if (req.user.role === 'admin') {
      return res.status(403).json({ error: 'Admins do not request work-from-home days' });
    }
    if (req.user.role === 'owner') return res.status(403).json({ error: 'Forbidden' });
    const workDate = String(req.body?.work_date || '').slice(0, 10);
    const reason = String(req.body?.reason || '').trim();
    if (!workDate) return res.status(400).json({ error: 'Work date is required' });
    const cairo = cairoParts();
    if (workDate < cairo.date) {
      return res.status(400).json({ error: 'Work from home cannot be requested for a past date' });
    }
    let staffUserId = req.user.id;
    if (isHrActor(req.user) && req.body?.staff_user_id) {
      staffUserId = Number(req.body.staff_user_id);
    }
    const target = await loadStaffForHr(staffUserId);
    assertCanTargetBenefits(target);
    if (!canRequestWfh(target.role)) {
      const error = isFieldOperationsRole(target.role)
        ? 'Operations staff work in the field and do not use office attendance or work-from-home days'
        : target.role === 'web_developer'
          ? 'Web developers work remotely and do not submit work-from-home requests'
          : 'Your role does not use work-from-home requests';
      return res.status(400).json({ error });
    }
    const { rows: existing } = await query(
      `SELECT id FROM staff_wfh_requests
       WHERE staff_user_id = $1 AND work_date = $2::date AND status IN ('pending','approved')
       LIMIT 1`,
      [staffUserId, workDate]
    );
    if (existing[0]) {
      return res.status(400).json({ error: 'A work-from-home request already exists for that day' });
    }
    const policy = wfhRequestPolicy(target.role);
    if (!policy.canRequest) {
      return res.status(403).json({ error: 'This role cannot request work-from-home days' });
    }
    const { rows } = await query(
      `INSERT INTO staff_wfh_requests
         (staff_user_id, work_date, reason, status, needs_manager_approval, needs_hr_approval)
       VALUES ($1,$2::date,$3,'pending',$4,$5)
       RETURNING *`,
      [staffUserId, workDate, reason || null, policy.needsManager, policy.needsHr]
    );
    res.status(201).json(
      presentStaffRequest(
        {
          ...rows[0],
          full_name: target.full_name,
          role: target.role,
          staff_code: target.staff_code,
          manager_id: target.manager_id,
          approval_mode: policy.approvalMode || 'all',
        },
        req.user,
        'wfh'
      )
    );
  } catch (e) {
    next(e);
  }
});

router.post('/hr/wfh/:id/review', async (req, res, next) => {
  try {
    const updated = await reviewStaffRequest({
      table: 'staff_wfh_requests',
      id: req.params.id,
      actor: req.user,
      body: req.body,
      onApprove: async (client, row, staff) => {
        const computed = computeHalfDayDeduction(staff.base_salary);
        const inserted = await insertDeduction(client, [
          row.staff_user_id,
          computed.amount,
          computed.label,
          row.work_date,
          'wfh',
          req.user.id,
          null,
          null,
          computed.daily_rate,
          computed.days_factor,
        ]);
        return { deduction_id: inserted?.id ?? null };
      },
    });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

router.get('/hr/holiday-access', requireRoles(...HR_ROLES), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, full_name, role, staff_code, is_active, created_at,
              COALESCE(holiday_access, 'auto') AS holiday_access
       FROM staff_users
       WHERE role NOT IN ('owner', 'admin')
       ORDER BY full_name`
    );
    const now = new Date();
    res.json(
      rows.map((r) => ({
        ...r,
        can_request_holidays: canRequestHolidays(r, now),
        tenure_months: monthsBetween(r.created_at, now),
      }))
    );
  } catch (e) {
    next(e);
  }
});

router.patch('/hr/holiday-access/:id', requireRoles(...HR_ROLES), async (req, res, next) => {
  try {
    const access = String(req.body?.holiday_access || '').toLowerCase();
    if (!['auto', 'granted', 'denied'].includes(access)) {
      return res.status(400).json({ error: 'holiday_access must be auto, granted, or denied' });
    }
    const staff = await loadStaffForHr(Number(req.params.id));
    assertCanEditStaffCompensation(req.user, staff.id, 'holiday access');
    const { rows } = await query(
      `UPDATE staff_users SET holiday_access = $1, updated_at = now() WHERE id = $2
       RETURNING id, full_name, role, staff_code, created_at,
                 COALESCE(holiday_access, 'auto') AS holiday_access`,
      [access, staff.id]
    );
    const row = rows[0];
    res.json({
      ...row,
      can_request_holidays: canRequestHolidays(row),
      tenure_months: monthsBetween(row.created_at, new Date()),
    });
  } catch (e) {
    next(e);
  }
});

function assertAttendanceExcelFile(file) {
  const name = String(file?.originalname || file?.name || '').trim();
  if (!/\.xlsx?$/i.test(name)) {
    const err = new Error('Upload an Excel Original Records Report (.xls or .xlsx) only');
    err.status = 400;
    throw err;
  }
}

function loadAttendanceJson(file) {
  assertAttendanceExcelFile(file);
  const buf = file.buffer;
  const head = buf.slice(0, 800).toString('utf8');
  // Some door systems export HTML tables saved as .xls — still require the Original Records columns.
  if (/<html/i.test(head) || /<table/i.test(head)) {
    return parseHtmlExcelTables(buf.toString('utf8'));
  }
  try {
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
    if (!wb.SheetNames?.length) {
      const err = new Error('The Excel file has no sheets');
      err.status = 400;
      throw err;
    }
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: '' });
  } catch (err) {
    if (err.status) throw err;
    const asText = buf.toString('utf8');
    if (/<td/i.test(asText)) return parseHtmlExcelTables(asText);
    const wrapped = new Error('Could not read the Excel file. Use the Original Records Report .xls/.xlsx template');
    wrapped.status = 400;
    throw wrapped;
  }
}

router.get('/hr/attendance', requireRoles(...HR_ROLES), async (req, res, next) => {
  try {
    const { year, month, from, to } = parsePeriod(req);
    const days = [];
    const cursor = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    while (cursor < end) {
      const y = cursor.getFullYear();
      const m = String(cursor.getMonth() + 1).padStart(2, '0');
      const d = String(cursor.getDate()).padStart(2, '0');
      days.push(`${y}-${m}-${d}`);
      cursor.setDate(cursor.getDate() + 1);
    }

    const { rows: staffRows } = await query(
      `SELECT id, full_name, role, staff_code, is_active,
              COALESCE(base_salary, 0)::float AS base_salary,
              COALESCE(office_attendance_exempt, false) AS office_attendance_exempt
       FROM staff_users
       WHERE COALESCE(is_active, 1)::int = 1
       ORDER BY full_name ASC, id ASC`
    );
    const staff = staffRows.filter((s) => hasOfficeAttendance(s.role, s));

    const { rows: attendanceRows } = await query(
      `SELECT staff_user_id, work_date::text AS work_date, status, check_in, check_out,
              deduction_amount, notified, notes
       FROM staff_attendance
       WHERE work_date >= $1::date AND work_date < $2::date`,
      [from, to]
    );
    const { rows: deductionRows } = await query(
      `SELECT staff_user_id, deduction_date::text AS deduction_date, category, amount,
              arrival_time, notified, reason
       FROM staff_salary_deductions
       WHERE category IN ('lateness', 'absence')
         AND deduction_date >= $1::date AND deduction_date < $2::date
       ORDER BY id`,
      [from, to]
    );
    const { rows: leaveRows } = await query(
      `SELECT id, staff_user_id, leave_type,
              start_date::text AS start_date, end_date::text AS end_date
       FROM staff_leave_requests
       WHERE status = 'approved'
         AND start_date < $2::date
         AND end_date >= $1::date`,
      [from, to]
    );

    const cells = {};
    for (const row of deductionRows) {
      cells[cellKey(row.staff_user_id, row.deduction_date)] = cellFromDeduction(row);
    }
    for (const row of attendanceRows) {
      cells[cellKey(row.staff_user_id, row.work_date)] = mapAttendanceRow(row);
    }
    const salaryByStaff = Object.fromEntries(staff.map((s) => [s.id, Number(s.base_salary) || 0]));
    for (const leave of leaveRows) {
      if (leaveDoesNotAffectAttendance(leave.leave_type)) continue;
      for (const date of days) {
        if (!dateCoveredByRanges(date, [leave])) continue;
        const baseSalary = salaryByStaff[leave.staff_user_id] || 0;
        cells[cellKey(leave.staff_user_id, date)] = {
          staff_user_id: leave.staff_user_id,
          work_date: date,
          status: 'holiday',
          leave_type: leave.leave_type,
          leave_request_id: leave.id,
          start_date: leave.start_date,
          end_date: leave.end_date,
          check_in: null,
          check_out: null,
          deduction_amount: leaveDayDeductionAmount(leave.leave_type, baseSalary),
          notified: false,
          notes: '',
        };
      }
    }

    res.json({
      year,
      month,
      from_date: from,
      to_date: to,
      days,
      staff: staff.map((s) => ({
        ...s,
        daily_rate: dailyRate(s.base_salary),
      })),
      cells,
    });
  } catch (e) {
    next(e);
  }
});

router.put('/hr/attendance', requireRoles(...HR_ROLES), async (req, res, next) => {
  try {
    const b = req.body || {};
    const staffUserId = Number(b.staff_user_id);
    const date = String(b.work_date || b.date || '').slice(0, 10);
    if (!staffUserId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Staff and date are required' });
    }
    const staff = await loadStaffForHr(staffUserId);
    if (!hasOfficeAttendance(staff.role, staff)) {
      return res.status(400).json({ error: 'This role does not use office attendance' });
    }

    if (b.clear === true || b.status === '' || b.status === 'clear') {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await removeSingleDayLeavesForDate(client, staff, date);
        await client.query(
          `DELETE FROM staff_salary_deductions
           WHERE staff_user_id = $1
             AND deduction_date = $2::date
             AND category IN ('lateness', 'absence')`,
          [staff.id, date]
        );
        await client.query(
          `DELETE FROM staff_attendance WHERE staff_user_id = $1 AND work_date = $2::date`,
          [staff.id, date]
        );
        await client.query('COMMIT');
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch (_) {}
        throw err;
      } finally {
        client.release();
      }
      return res.json({ ok: true, cleared: true, staff_user_id: staff.id, work_date: date });
    }

    const status = String(b.status || '').trim();
    if (status === 'holiday') {
      const cell = await setAttendanceHolidayDay({
        staff,
        date,
        leaveType: b.leave_type,
        actorId: req.user.id,
      });
      return res.json({ ok: true, cell });
    }

    // Switching to an attendance status removes a single-day holiday on that date.
    const covering = await loadCoveringAttendanceLeaves(staff.id, date);
    if (covering.length) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await removeSingleDayLeavesForDate(client, staff, date);
        await client.query('COMMIT');
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch (_) {}
        throw err;
      } finally {
        client.release();
      }
    }

    const amountRaw = b.deduction_amount;
    const amount =
      amountRaw === '' || amountRaw == null || amountRaw === undefined
        ? null
        : Number(amountRaw);
    const cell = await upsertAttendanceRecord({
      staff,
      date,
      status,
      checkIn: b.check_in,
      checkOut: b.check_out,
      amount,
      notified: b.notified,
      actorId: req.user.id,
    });
    res.json({ ok: true, cell });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

router.post(
  '/hr/attendance/import',
  requireRoles(...HR_ROLES),
  (req, res, next) => {
    excelUpload.single('file')(req, res, (err) => {
      if (!err) return next();
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Excel file is too large (max 20 MB)'
          : err.message || 'Upload an Excel Original Records Report (.xls or .xlsx) only';
      return res.status(400).json({ error: message });
    });
  },
  async (req, res, next) => {
    try {
      if (!req.file?.buffer) {
        return res.status(400).json({ error: 'Upload an Excel Original Records Report (.xls or .xlsx)' });
      }
      let json;
      try {
        json = loadAttendanceJson(req.file);
        assertOriginalRecordsAttendanceTemplate(json);
      } catch (err) {
        return res.status(err.status || 400).json({ error: err.message });
      }
      const punches = parseAttendanceRows(json).filter((r) => r.staff_code || r.name || r.date);
      if (!punches.length) {
        return res.status(400).json({
          error: 'The sheet has no attendance rows. Use Person ID, Time, and Attendance Status',
        });
      }
      if (!isDoorPunchLog(punches)) {
        return res.status(400).json({
          error:
            'Wrong template. Attendance Status must include Check-in / Check-out (Original Records Report)',
        });
      }
      let parsed = collapsePunchAttendance(punches);
      if (!parsed.length) {
        return res.status(400).json({
          error: 'Could not read punch times. Check the Time column uses dates like 8/30/2026 11:06',
        });
      }

      const { rows: staffRows } = await query(
        `SELECT id, staff_code, full_name, base_salary, role,
                COALESCE(office_attendance_exempt, false) AS office_attendance_exempt
         FROM staff_users WHERE role <> 'owner'`
      );

      parsed = parsed.concat(fillMissingOfficeAbsences(parsed, staffRows));

      const dates = parsed.map((p) => p.date).filter(Boolean).sort();
      const minDate = dates[0] || cairoParts().date;
      const maxDate = dates[dates.length - 1] || minDate;

      const { rows: leaveRows } = await query(
        `SELECT staff_user_id, leave_type,
                start_date::text AS start_date, end_date::text AS end_date
         FROM staff_leave_requests
         WHERE status = 'approved' AND start_date <= $2::date AND end_date >= $1::date`,
        [minDate, maxDate]
      );
      const leavesByStaff = new Map();
      for (const l of leaveRows) {
        if (leaveDoesNotAffectAttendance(l.leave_type)) continue;
        const list = leavesByStaff.get(l.staff_user_id) || [];
        list.push(l);
        leavesByStaff.set(l.staff_user_id, list);
      }

      const { rows: wfhRows } = await query(
        `SELECT staff_user_id, work_date::text AS work_date
         FROM staff_wfh_requests
         WHERE status = 'approved' AND work_date >= $1::date AND work_date <= $2::date`,
        [minDate, maxDate]
      );
      const wfhByStaff = new Map();
      for (const w of wfhRows) {
        const set = wfhByStaff.get(w.staff_user_id) || new Set();
        set.add(w.work_date);
        wfhByStaff.set(w.staff_user_id, set);
      }

      const staffById = new Map(staffRows.map((s) => [String(s.id), s]));
      const staffByCode = new Map();
      for (const s of staffRows) {
        const code = normalizePersonId(s.staff_code).toLowerCase();
        if (code && !staffByCode.has(code)) staffByCode.set(code, s);
      }
      const findStaff = (row) => {
        const code = normalizePersonId(row.staff_code);
        // Door Person ID = Staff ID (staff_code). Prefer that over internal user id.
        if (code && staffByCode.has(code.toLowerCase())) return staffByCode.get(code.toLowerCase());
        if (code && /^\d+$/.test(code) && staffById.has(code)) return staffById.get(code);
        return matchAttendanceStaff(row, staffRows);
      };

      const created = [];
      const skipped = [];
      const errors = [];
      const writesByKey = new Map();

      for (const row of parsed) {
        if (!row.date) {
          errors.push({ row: row.row, error: 'Missing date' });
          continue;
        }
        const staff = findStaff(row);
        if (!staff) {
          errors.push({
            row: row.row,
            error: `Unknown staff (${row.staff_code || row.name || 'blank'})`,
          });
          continue;
        }
        if (!hasOfficeAttendance(staff.role, staff)) {
          skipped.push({ row: row.row, staff_user_id: staff.id, reason: 'no_office_attendance' });
          continue;
        }
        if (dateCoveredByRanges(row.date, leavesByStaff.get(staff.id) || [])) {
          skipped.push({ row: row.row, staff_user_id: staff.id, reason: 'approved_holiday' });
          continue;
        }
        if ((wfhByStaff.get(staff.id) || new Set()).has(row.date)) {
          skipped.push({ row: row.row, staff_user_id: staff.id, reason: 'approved_wfh' });
          continue;
        }

        try {
          const absent = row.absent || !row.arrival_time;
          const computed = absent
            ? null
            : computeLatenessDeduction(staff.base_salary, row.arrival_time);
          const write = buildAttendanceWrite({
            staff,
            date: row.date,
            status: absent ? 'no_show' : computed.factor <= 0 ? 'on_time' : 'late',
            checkIn: absent ? null : row.arrival_time,
            checkOut: absent ? null : row.check_out,
            amount: absent ? null : computed.amount,
            notified: row.notified,
            actorId: req.user.id,
          });
          writesByKey.set(`${staff.id}|${row.date}`, write);
          if (!absent && computed.factor <= 0) {
            skipped.push({ row: row.row, staff_user_id: staff.id, reason: 'on_time' });
          }
        } catch (err) {
          errors.push({ row: row.row, error: err.message || 'Could not import row' });
        }
      }

      const writes = [...writesByKey.values()];
      if (writes.length) await bulkWriteAttendance(writes);
      created.push(...writes.map((w) => w.cell));

      res.json({
        ok: true,
        created: created.length,
        skipped: skipped.length,
        errors,
        skipped_details: skipped,
        deductions: created,
      });
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;
