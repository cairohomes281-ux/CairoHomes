const { namesAreAliases } = require('./salesNameMatch');

const DAYS_IN_MONTH = 30;
const HOURS_IN_DAY = 24;
const SHIFT_START_MINUTES = 11 * 60;
const GRACE_END_MINUTES = 11 * 60 + 15;
const LATE_QUARTER_END = 11 * 60 + 30;
const LATE_HALF_END = 12 * 60;
const PAID_EXCUSE_MAX_PER_MONTH = 2;
const PAID_EXCUSE_MAX_HOURS = 2;
/** @deprecated use PAID_EXCUSE_MAX_PER_MONTH */
const EARLY_LEAVE_MAX_PER_YEAR = PAID_EXCUSE_MAX_PER_MONTH;
const ANNUAL_EXTENDED_NOTICE_DAYS = 7;
const ANNUAL_EXTENDED_MIN_DURATION = 3;
const TIMEZONE = 'Africa/Cairo';

const EXCUSE_LEAVE_TYPES = new Set(['paid_excuse', 'unpaid_excuse', 'early_leave']);

function roundMoney(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function dailyRate(baseSalary) {
  const salary = Number(baseSalary) || 0;
  return roundMoney(salary / DAYS_IN_MONTH);
}

function hourlyRate(baseSalary) {
  return roundMoney(dailyRate(baseSalary) / HOURS_IN_DAY);
}

function isExcuseLeaveType(leaveType) {
  return EXCUSE_LEAVE_TYPES.has(String(leaveType || '').toLowerCase());
}

function isMissionLeaveType(leaveType) {
  return String(leaveType || '').toLowerCase() === 'mission';
}

/** Timed paid/unpaid windows that do not block the attendance schedule. */
function leaveDoesNotAffectAttendance(leaveType) {
  const t = normalizeExcuseLeaveType(leaveType);
  return isExcuseLeaveType(t) || isMissionLeaveType(t);
}

function normalizeExcuseLeaveType(leaveType) {
  const t = String(leaveType || '').toLowerCase();
  if (t === 'early_leave') return 'paid_excuse';
  return t;
}

function parseHhMm(value) {
  const text = String(value || '').trim();
  const m = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

/** @returns {{ factor: number, band: string, label: string } | { factor: 0, band: 'grace', label: string }} */
function latenessFactor(arrivalMinutes) {
  if (!Number.isFinite(arrivalMinutes)) {
    const err = new Error('Arrival time is required for lateness');
    err.status = 400;
    throw err;
  }
  if (arrivalMinutes <= GRACE_END_MINUTES) {
    return {
      factor: 0,
      band: 'grace',
      label: 'On time (11:00–11:15, no deduction)',
    };
  }
  if (arrivalMinutes <= LATE_QUARTER_END) {
    return {
      factor: 0.25,
      band: 'quarter',
      label: '11:16–11:30 · 0.25 × daily rate',
    };
  }
  if (arrivalMinutes <= LATE_HALF_END) {
    return {
      factor: 0.5,
      band: 'half',
      label: '11:31–12:00 · 0.5 × daily rate',
    };
  }
  return {
    factor: 1,
    band: 'full',
    label: 'After 12:00 PM · 1 × daily rate',
  };
}

function absenceFactor() {
  return 2;
}

function computeLatenessDeduction(baseSalary, arrivalTime) {
  const minutes = typeof arrivalTime === 'number' ? arrivalTime : parseHhMm(arrivalTime);
  if (minutes == null) {
    const err = new Error('Arrival time must be HH:MM');
    err.status = 400;
    throw err;
  }
  const rate = dailyRate(baseSalary);
  const late = latenessFactor(minutes);
  return {
    ...late,
    daily_rate: rate,
    amount: roundMoney(rate * late.factor),
    arrival_minutes: minutes,
  };
}

function computeAbsenceDeduction(baseSalary) {
  const rate = dailyRate(baseSalary);
  const factor = absenceFactor();
  return {
    factor,
    daily_rate: rate,
    amount: roundMoney(rate * factor),
    notified: false,
    label: 'No show · 2 × daily rate',
  };
}

function computeUnpaidLeaveDeduction(baseSalary) {
  const rate = dailyRate(baseSalary);
  return {
    factor: 1,
    daily_rate: rate,
    amount: rate,
    label: 'Unpaid leave · 1 × daily rate',
  };
}

function computeUnpaidExcuseDeduction(baseSalary, hours) {
  const hrs = Number(hours) || 0;
  const rate = hourlyRate(baseSalary);
  return {
    hours: hrs,
    hourly_rate: rate,
    daily_rate: dailyRate(baseSalary),
    amount: roundMoney(rate * hrs),
    label: `Unpaid excuse · ${hrs}h × hourly rate`,
  };
}

function leaveDayDeductionAmount(leaveType, baseSalary, hours = 0) {
  const t = String(leaveType || '').toLowerCase();
  if (t === 'unpaid') {
    return computeUnpaidLeaveDeduction(baseSalary).amount;
  }
  if (t === 'unpaid_excuse') {
    return computeUnpaidExcuseDeduction(baseSalary, hours).amount;
  }
  return 0;
}

function formatExcuseTime(value) {
  const mins = parseHhMm(value);
  if (mins == null) return null;
  const hh = Math.floor(mins / 60);
  const mm = mins % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function excuseHoursFromTimes(startTime, endTime) {
  const start = parseHhMm(startTime);
  const end = parseHhMm(endTime);
  if (start == null || end == null) {
    const err = new Error('Start and end times are required (HH:MM)');
    err.status = 400;
    throw err;
  }
  if (end <= start) {
    const err = new Error('End time must be after start time');
    err.status = 400;
    throw err;
  }
  return roundMoney((end - start) / 60);
}

function assertExcuseWindow(leaveType, startTime, endTime) {
  const hours = excuseHoursFromTimes(startTime, endTime);
  const type = normalizeExcuseLeaveType(leaveType);
  if (type === 'paid_excuse' && hours > PAID_EXCUSE_MAX_HOURS + 1e-9) {
    const err = new Error(`Paid excuses are limited to ${PAID_EXCUSE_MAX_HOURS} hours each`);
    err.status = 400;
    throw err;
  }
  if (hours <= 0) {
    const err = new Error('Excuse duration must be greater than 0');
    err.status = 400;
    throw err;
  }
  return {
    hours,
    start_time: formatExcuseTime(startTime),
    end_time: formatExcuseTime(endTime),
  };
}

/** Mission: any positive duration, no monthly/hour cap. */
function assertMissionWindow(startTime, endTime) {
  const hours = excuseHoursFromTimes(startTime, endTime);
  if (hours <= 0) {
    const err = new Error('Mission duration must be greater than 0');
    err.status = 400;
    throw err;
  }
  return {
    hours,
    start_time: formatExcuseTime(startTime),
    end_time: formatExcuseTime(endTime),
  };
}

function enumerateDateRange(start, end) {
  const dates = [];
  let cur = String(start || '').slice(0, 10);
  const last = String(end || '').slice(0, 10);
  if (!cur || !last || cur > last) return dates;
  while (cur <= last) {
    dates.push(cur);
    cur = addDaysIso(cur, 1);
  }
  return dates;
}

function cairoParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function addDaysIso(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Request timing rules removed — past / same-day leave requests are allowed. */
function assertCasualTiming() {}

function assertAnnualNotice() {}

function assertEarlyLeaveTiming() {}

function assertExcuseTiming() {}

const HOLIDAY_ACCESS_MONTHS = 6;

function monthsBetween(fromDate, toDate) {
  const from = fromDate instanceof Date ? fromDate : new Date(fromDate);
  const to = toDate instanceof Date ? toDate : new Date(toDate);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  const years = to.getFullYear() - from.getFullYear();
  const months = to.getMonth() - from.getMonth();
  let total = years * 12 + months;
  if (to.getDate() < from.getDate()) total -= 1;
  return total;
}

function canRequestHolidays({ holiday_access, created_at }, now = new Date()) {
  const mode = String(holiday_access || 'auto').toLowerCase();
  if (mode === 'granted') return true;
  if (mode === 'denied') return false;
  return monthsBetween(created_at, now) >= HOLIDAY_ACCESS_MONTHS;
}

function leaveTypeRequiresHolidayAccess(leaveType) {
  const t = normalizeExcuseLeaveType(leaveType);
  // Annual and casual need holiday access. Unpaid, excuses, and missions do not.
  return t === 'annual' || t === 'casual';
}

function leaveTypeRequiresApproval(leaveType) {
  // All holiday and excuse types need permission (none are auto-approved).
  return true;
}

/** @returns {'all' | 'any'} */
function leaveTypeApprovalMode(_leaveType) {
  // All leave types require both direct manager and HR Manager (sequential).
  return 'all';
}

/**
 * Approval requirements for a leave/excuse type, adjusted for the requester's role.
 * Default: direct manager AND HR Manager (sequential).
 * HR Manager requesters: line manager (CEO) only — cannot self-approve the HR slot.
 */
function leaveApprovalPolicy(leaveType, role) {
  const rolePolicy = staffRequestPolicy(role);
  if (!rolePolicy.canRequest) {
    return { canRequest: false, needsManager: false, needsHr: false, approvalMode: 'all' };
  }

  let needsManager = true;
  let needsHr = true;
  const approvalMode = 'all';

  const r = String(role || '');
  if (r === 'hr_supervisor') {
    // HR Manager cannot self-approve the HR slot — their line manager (CEO) reviews.
    needsHr = false;
    needsManager = true;
  } else if (r === 'hr') {
    // HR staff: both their assigned manager and HR Manager (may be the same person sequentially).
    needsManager = true;
    needsHr = true;
  } else {
    needsManager = rolePolicy.needsManager !== false;
    needsHr = rolePolicy.needsHr !== false;
  }

  return { canRequest: true, needsManager, needsHr, approvalMode };
}

function requestApprovalMode(request) {
  const raw = String(request?.approval_mode || '').toLowerCase();
  if (raw === 'any' || raw === 'all') return raw;
  if (request?.leave_type) return leaveTypeApprovalMode(request.leave_type);
  // WFH shares the annual-holiday sequential cycle (manager → HR).
  if (request?.request_kind === 'wfh' || request?.work_date != null) return 'all';
  return 'all';
}

const HR_TEAM_ROLES = ['hr', 'hr_supervisor'];

function isHrTeamRole(role) {
  return HR_TEAM_ROLES.includes(String(role || ''));
}

function isHrActingOnSelf(actor, targetUserId) {
  return isHrTeamRole(actor?.role) && targetUserId != null && String(actor.id) === String(targetUserId);
}

function appliesSalaryImmediately(actor) {
  return actor?.role === 'admin' || isHrTeamRole(actor?.role);
}

function canEditStaffCompensation(actor, targetUserId) {
  if (!actor) return false;
  if (actor.role === 'admin') return true;
  // HR team can edit pay/leave for any staff account (including their own).
  if (isHrTeamRole(actor.role)) return true;
  return false;
}

function assertCanEditStaffCompensation(
  actor,
  targetUserId,
  label = 'salary, holiday balances, or holiday access'
) {
  if (canEditStaffCompensation(actor, targetUserId)) return;
  const err = new Error(`Only HR, an HR Manager, or a CEO can change ${label}`);
  err.status = 403;
  throw err;
}

/** @deprecated No longer blocks HR self-edits; kept for callers that still import it. */
function assertHrNotEditingOwnCompensation() {
  return;
}

function nextPayrollPeriod(isoDate) {
  const [y, m] = String(isoDate).slice(0, 10).split('-').map(Number);
  if (m === 12) return { year: y + 1, month: 1, deductionDate: `${y + 1}-01-01` };
  return {
    year: y,
    month: m + 1,
    deductionDate: `${y}-${String(m + 1).padStart(2, '0')}-01`,
  };
}

function dateCoveredByRanges(isoDate, ranges = []) {
  return ranges.some((r) => r.start_date <= isoDate && isoDate <= r.end_date);
}

function excelSerialToIso(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n)) return null;
  const utc = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000;
  const d = new Date(utc);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function excelTimeToHhMm(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
  }
  if (typeof value === 'number' && value >= 0 && value < 1.5) {
    const mins = Math.round((value % 1) * 24 * 60);
    const hh = Math.floor(mins / 60) % 24;
    const mm = mins % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  const text = String(value || '').trim();
  const stamp = text.match(/(?:^|[ T])(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (stamp) {
    const hh = Number(stamp[1]);
    const mm = Number(stamp[2]);
    if (hh <= 23 && mm <= 59) {
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
  }
  const parsed = parseHhMm(value);
  if (parsed == null) return null;
  const hh = Math.floor(parsed / 60);
  const mm = parsed % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function toIsoDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  if (typeof value === 'number') return excelSerialToIso(value);
  const s = String(value || '').trim();
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  // Original Records Report uses M/D/YYYY (optionally with time), e.g. "8/30/2026 11:06".
  const mdY = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdY) {
    const month = Number(mdY[1]);
    const day = Number(mdY[2]);
    const year = Number(mdY[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return null;
}

/** Default checkout when the door report has check-in but no check-out. */
const DEFAULT_ATTENDANCE_CHECKOUT = '19:00';

function assertOriginalRecordsAttendanceTemplate(rows) {
  const sample = (rows || []).find((row) => row && typeof row === 'object') || null;
  if (!sample) {
    const err = new Error(
      'Upload the Original Records Report Excel (.xls or .xlsx) with Person ID, Time, and Attendance Status columns'
    );
    err.status = 400;
    throw err;
  }
  const keys = Object.keys(sample).map((k) => normalizeHeader(k));
  const hasPerson = keys.includes('person_id') || keys.includes('personal_id');
  const hasTime = keys.includes('time');
  const hasStatus = keys.includes('attendance_status');
  if (!hasPerson || !hasTime || !hasStatus) {
    const err = new Error(
      'Wrong template. Use the Original Records Report Excel with columns Person ID (or Personal ID), Time, and Attendance Status'
    );
    err.status = 400;
    throw err;
  }
}

function normalizePersonId(value) {
  // Door reports often force text with a leading apostrophe: "'15" → "15".
  return String(value ?? '')
    .trim()
    .replace(/^[\s'‘’‛`]+/, '')
    .replace(/\.0$/, '')
    .trim();
}

function matchAttendanceStaff(row, staffList) {
  const list = staffList || [];
  const code = normalizePersonId(row?.staff_code).toLowerCase();
  // Door Person ID is the Staff ID (staff_code), not the internal user id.
  // Prefer staff_code so "'90" maps to staff_code 90, not user id 90.
  if (code) {
    const byCode = list.filter(
      (s) => normalizePersonId(s.staff_code).toLowerCase() === code
    );
    if (byCode.length === 1) return byCode[0];
  }
  if (code && /^\d+$/.test(code)) {
    const byId = list.filter((s) => String(s.id) === code);
    if (byId.length === 1) return byId[0];
  }
  const name = String(row?.name || '').trim();
  if (!name) return null;
  const exact = list.filter(
    (s) => String(s.full_name || '').trim().toLowerCase() === name.toLowerCase()
  );
  if (exact.length === 1) return exact[0];
  const aliased = list.filter((s) => namesAreAliases(s.full_name, name));
  if (aliased.length === 1) return aliased[0];
  const n = name.toLowerCase();
  const prefix = list.filter((s) => {
    const full = String(s.full_name || '').trim().toLowerCase();
    return full === n || full.startsWith(`${n} `) || n.startsWith(`${full} `);
  });
  if (prefix.length === 1) return prefix[0];
  return null;
}

function normalizeHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
}

function truthyNotice(value) {
  const t = String(value || '').trim().toLowerCase();
  return ['1', 'yes', 'y', 'true', 'notified', 'with notice', 'with_notice'].includes(t);
}

function stripHtmlCell(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .trim();
}

function parseHtmlExcelTables(html) {
  const rowCells = String(html)
    .split(/<\/tr>/i)
    .map((frag) =>
      [...frag.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripHtmlCell(m[1]))
    )
    .filter((cells) => cells.length > 0);

  const headerRowIdx = rowCells.findIndex(
    (cells) =>
      cells.some((c) => /^(person|personal)\s*id$/i.test(c)) &&
      cells.some((c) => /^time$/i.test(c)) &&
      cells.some((c) => /^attendance\s*status$/i.test(c))
  );
  if (headerRowIdx >= 0) {
    const headers = rowCells[headerRowIdx];
    const rows = [];
    for (let r = headerRowIdx + 1; r < rowCells.length; r += 1) {
      const cells = rowCells[r];
      if (cells.length < 3) continue;
      const obj = {};
      const n = Math.min(headers.length, cells.length);
      for (let c = 0; c < n; c += 1) obj[headers[c]] = cells[c];
      const person = normalizePersonId(obj[headers[0]]);
      if (!person || /^(person|personal)\s*id$/i.test(person)) continue;
      rows.push(obj);
    }
    if (rows.length) return rows;
  }

  const cells = rowCells.flat();
  const headerIdx = cells.findIndex((c) => /^(person|personal)\s*id$/i.test(c));
  if (headerIdx < 0) return [];
  const headers = [];
  let i = headerIdx;
  while (i < cells.length && headers.length < 11) {
    headers.push(cells[i]);
    i += 1;
  }
  const colCount = headers.length;
  if (colCount < 3) return [];
  const rows = [];
  while (i + colCount <= cells.length) {
    const obj = {};
    for (let c = 0; c < colCount; c += 1) obj[headers[c]] = cells[i + c];
    rows.push(obj);
    i += colCount;
  }
  return rows;
}

function parseAttendanceRows(rows) {
  return (rows || []).map((row, index) => {
    const keys = Object.keys(row || {});
    const pick = (...aliases) => {
      for (const alias of aliases) {
        const key = keys.find((k) => normalizeHeader(k) === alias);
        if (key != null && row[key] != null && String(row[key]).trim() !== '') return row[key];
      }
      return null;
    };
    const timeRaw = pick('time', 'arrival_time', 'arrival', 'check_in', 'checkin', 'clock_in');
    let dateVal = toIsoDate(pick('date', 'day', 'attendance_date')) || toIsoDate(timeRaw);
    const status = String(pick('attendance_status', 'status', 'type', 'attendance') || '').toLowerCase();
    const isCheckIn = /(?:check|clock|overtime)[\s_-]*in/.test(status);
    const isCheckOut = /(?:check|clock|overtime)[\s_-]*out/.test(status);
    const arrival_time = timeRaw != null ? excelTimeToHhMm(timeRaw) : null;
    const explicitAbsent = /absent|absence|no.show/.test(status);
    const absent = explicitAbsent || (!isCheckIn && !isCheckOut && !arrival_time);
    const staffCode = normalizePersonId(
      pick('person_id', 'personal_id', 'staff_code', 'staff_id', 'code')
    );
    const name = pick('name', 'full_name', 'staff', 'employee');
    return {
      row: index + 2,
      staff_code: staffCode,
      name: name ? String(name).trim() : '',
      date: dateVal,
      arrival_time: absent ? null : arrival_time,
      notified: truthyNotice(pick('notified', 'notice', 'with_notice')),
      absent,
      status,
      is_check_in: isCheckIn,
      is_check_out: isCheckOut,
    };
  });
}

function isDoorPunchLog(rows) {
  return (rows || []).some((r) => r.is_check_in || r.is_check_out);
}

function timeToMinutes(hhmm) {
  return parseHhMm(hhmm);
}

function collapsePunchAttendance(rows) {
  const byKey = new Map();
  for (const row of rows || []) {
    if (!row.staff_code || !row.date) continue;
    const key = `${row.staff_code.toLowerCase()}|${row.date}`;
    const cur = byKey.get(key) || {
      staff_code: row.staff_code,
      name: row.name,
      date: row.date,
      checkIns: [],
      checkOuts: [],
      punches: [],
      notified: false,
      explicitAbsent: false,
    };
    if (row.name && !cur.name) cur.name = row.name;
    if (row.notified) cur.notified = true;
    if (row.absent && !row.is_check_in && !row.is_check_out) cur.explicitAbsent = true;
    if (row.arrival_time) {
      cur.punches.push(row.arrival_time);
      if (row.is_check_in) cur.checkIns.push(row.arrival_time);
      if (row.is_check_out) cur.checkOuts.push(row.arrival_time);
    }
    byKey.set(key, cur);
  }
  return [...byKey.values()].map((cur) => {
    const pickEarliest = (times) =>
      times
        .slice()
        .sort((a, b) => (timeToMinutes(a) ?? 0) - (timeToMinutes(b) ?? 0))[0] || null;
    const pickLatest = (times) =>
      times
        .slice()
        .sort((a, b) => (timeToMinutes(b) ?? 0) - (timeToMinutes(a) ?? 0))[0] || null;
    const arrival = pickEarliest(cur.checkIns) || pickEarliest(cur.punches);
    let check_out = pickLatest(cur.checkOuts);
    if (!check_out && cur.punches.length > 1) {
      const last = pickLatest(cur.punches);
      if (last && last !== arrival) check_out = last;
    }
    // Door reports often only log check-in; missing checkout defaults to 7:00 PM that day.
    if (!check_out && arrival) check_out = DEFAULT_ATTENDANCE_CHECKOUT;
    const absent = cur.explicitAbsent && !arrival;
    return {
      staff_code: cur.staff_code,
      name: cur.name,
      date: cur.date,
      arrival_time: absent ? null : arrival,
      check_out: absent ? null : check_out,
      notified: cur.notified,
      absent,
    };
  });
}

function fillMissingOfficeAbsences(dailyRows, staffList) {
  const workDates = new Set();
  const present = new Set();
  for (const row of dailyRows || []) {
    const staff = matchAttendanceStaff(row, staffList);
    if (!staff || !hasOfficeAttendance(staff.role, staff) || !row.date) continue;
    present.add(`${staff.id}|${row.date}`);
    if (!row.absent) workDates.add(row.date);
  }
  const extra = [];
  for (const staff of staffList || []) {
    if (!hasOfficeAttendance(staff.role, staff)) continue;
    for (const date of workDates) {
      const key = `${staff.id}|${date}`;
      if (present.has(key)) continue;
      extra.push({
        staff_code: String(staff.id),
        name: staff.full_name,
        date,
        arrival_time: null,
        check_out: null,
        notified: false,
        absent: true,
      });
      present.add(key);
    }
  }
  return extra;
}

function computeHalfDayDeduction(baseSalary) {
  const rate = dailyRate(baseSalary);
  return {
    daily_rate: rate,
    days_factor: 0.5,
    amount: roundMoney(rate * 0.5),
    label: 'Work from home · 0.5 × daily rate',
  };
}

const PENALTY_CATEGORIES = ['lateness', 'absence', 'delay', 'performance', 'penalty'];
const LINE_MANAGER_ROLES = new Set([
  'admin',
  'hr_supervisor',
  'reservations_manager',
  'resale_manager',
  'unit_acquisition_manager',
  'operations_supervisor',
  'finance_manager',
]);
/** Line managers who still clock office attendance (door report). */
const OFFICE_ATTENDANCE_LINE_MANAGER_ROLES = new Set([
  'resale_manager',
  'unit_acquisition_manager',
]);
const NO_OFFICE_ATTENDANCE_ROLES = new Set([
  ...[...LINE_MANAGER_ROLES].filter((r) => !OFFICE_ATTENDANCE_LINE_MANAGER_ROLES.has(r)),
  'owner',
  'operations',
  'web_developer',
]);
const NO_STAFF_BENEFIT_ROLES = new Set(['admin', 'owner']);
const UNPAID_LEAVE_UNLIMITED = true;

const { staffManagerIds, supportsMultipleManagers } = require('./staffManagers');

function isUnpaidLeaveUnlimited() {
  return UNPAID_LEAVE_UNLIMITED;
}

function hasOfficeAttendance(role, staff) {
  if (staff && staff.office_attendance_exempt) return false;
  return !NO_OFFICE_ATTENDANCE_ROLES.has(String(role || ''));
}

function isFieldOperationsRole(role) {
  const r = String(role || '');
  return r === 'operations' || r === 'operations_supervisor';
}

function canRequestWfh(role) {
  const r = String(role || '');
  if (!canRequestStaffBenefits(r)) return false;
  if (isFieldOperationsRole(r)) return false;
  if (r === 'web_developer') return false;
  return true;
}

function canRequestStaffBenefits(role) {
  return !NO_STAFF_BENEFIT_ROLES.has(String(role || ''));
}

/** Any staff role may request a salary loan (including admin / owner). */
function canRequestLoan(role) {
  return Boolean(String(role || '').trim());
}

function staffRequestPolicy(role) {
  const r = String(role || '');
  if (!canRequestStaffBenefits(r)) {
    return { canRequest: false, needsManager: false, needsHr: false };
  }
  if (r === 'hr_supervisor') return { canRequest: true, needsManager: true, needsHr: false };
  // Everyone else (including HR staff): direct manager then HR Manager.
  return { canRequest: true, needsManager: true, needsHr: true };
}

/**
 * WFH uses the same cycle as holidays: manager first, then HR Manager.
 */
function wfhRequestPolicy(role) {
  const base = staffRequestPolicy(role);
  return { ...base, approvalMode: 'all' };
}

function isWfhRequest(request) {
  if (!request || typeof request !== 'object') return false;
  if (request.request_kind === 'wfh') return true;
  if (request.leave_type != null) return false;
  return request.work_date != null;
}

/**
 * Loans: HR Manager → Financial Manager (sequential). No line-manager step.
 * Role exceptions avoid self-approval of finance/HR slots.
 */
function loanRequestPolicy(role) {
  const r = String(role || '');
  if (!canRequestLoan(r)) {
    return { canRequest: false, needsManager: false, needsFinance: false, needsHr: false };
  }
  if (r === 'finance_manager') {
    // Cannot self-approve finance — manager (CEO) then HR Manager.
    return { canRequest: true, needsManager: true, needsFinance: false, needsHr: true };
  }
  if (r === 'hr_supervisor') {
    // Cannot self-approve HR — manager then Financial Manager.
    return { canRequest: true, needsManager: true, needsFinance: true, needsHr: false };
  }
  // Default (including admin): HR Manager → Financial Manager.
  return { canRequest: true, needsManager: false, needsFinance: true, needsHr: true };
}

function isLoanRequest(request) {
  if (!request || typeof request !== 'object') return false;
  if (request.request_kind === 'loan') return true;
  if (request.leave_type != null) return false;
  if (request.work_date != null) return false;
  return request.amount != null;
}

function requestNeedsFinance(request) {
  return isLoanRequest(request) && request.needs_finance_approval !== false;
}

function requestNeedsManager(request) {
  return request.needs_manager_approval !== false;
}

function requestNeedsHr(request) {
  return request.needs_hr_approval !== false;
}

function isSequentialApproval(request) {
  if (isLoanRequest(request)) return true;
  return requestApprovalMode(request) !== 'any';
}

function departmentManagerRole(role) {
  switch (String(role || '')) {
    case 'operations':
      return 'operations_supervisor';
    case 'hr':
      return 'hr_supervisor';
    case 'reservations':
    case 'reservations_web':
    case 'reservations_manual':
      return 'reservations_manager';
    case 'unit_acquisition_agent':
      return 'unit_acquisition_manager';
    case 'resale':
      return 'resale_manager';
    case 'finance':
      return 'finance_manager';
    case 'reservations_manager':
    case 'resale_manager':
    case 'unit_acquisition_manager':
    case 'finance_manager':
    case 'hr_supervisor':
    case 'operations_supervisor':
    case 'marketing_pr':
    case 'web_developer':
      return 'admin';
    default:
      return null;
  }
}

function isDirectStaffManager(actor, staff) {
  if (!actor || !staff) return false;
  if (String(actor.id) === String(staff.id)) return false;
  return staffManagerIds(staff).includes(String(actor.id));
}

function isLineManager(actor, staff) {
  if (!actor || !staff) return false;
  if (String(actor.id) === String(staff.id)) return false;
  // Multi-manager roles (e.g. web_developer): only the primary manager approves.
  if (supportsMultipleManagers(staff.role)) {
    return staff.manager_id != null && String(actor.id) === String(staff.manager_id);
  }
  // Everyone else: assigned manager link only (not whole department by role).
  return isDirectStaffManager(actor, staff);
}

function canViewAllStaffRequests(actor, { history = false } = {}) {
  // CEO always sees every request.
  if (actor?.role === 'admin') return true;
  // HR and HR Manager see company-wide history (not the live review queue).
  if (history && (actor?.role === 'hr' || actor?.role === 'hr_supervisor')) return true;
  return false;
}

function canSeeRequestHistory(actor) {
  if (!actor) return false;
  if (actor.role === 'admin' || actor.role === 'hr' || actor.role === 'hr_supervisor') return true;
  return isLineManagerRoleForHistory(actor.role);
}

function isLineManagerRoleForHistory(role) {
  return [
    'admin',
    'hr_supervisor',
    'reservations_manager',
    'resale_manager',
    'finance_manager',
    'unit_acquisition_manager',
    'operations_supervisor',
  ].includes(String(role || ''));
}

function eligibleReviewSlots(actor, request, staff) {
  if (!actor || !request || request.status !== 'pending') return [];
  if (String(actor.id) === String(request.staff_user_id || staff?.id)) return [];
  if (actor.role === 'admin') return ['admin'];

  const needsManager = requestNeedsManager(request);
  const needsFinance = requestNeedsFinance(request);
  const needsHr = requestNeedsHr(request);
  const managerDone = Boolean(request.manager_reviewed_by);
  const financeDone = Boolean(request.finance_reviewed_by);
  const hrDone = Boolean(request.hr_reviewed_by);
  const managerCleared = !needsManager || managerDone;
  const sequential = isSequentialApproval(request);

  const staffShape = staff || {
    id: request.staff_user_id,
    role: request.role,
    manager_id: request.manager_id,
    manager_ids: request.manager_ids,
  };

  const slots = [];

  // Step 1 — line manager (always first when required).
  if (needsManager && !managerDone && isLineManager(actor, staffShape)) {
    slots.push('manager');
  }

  // Step 2 — HR Manager (after manager when sequential).
  // Loans: HR accepts before Financial Manager.
  if (needsHr && !hrDone && actor.role === 'hr_supervisor') {
    if (!sequential || managerCleared) {
      slots.push('hr');
    }
  }

  // Step 3 — Financial Manager (loans), after manager + HR when sequential.
  if (needsFinance && !financeDone && actor.role === 'finance_manager') {
    const hrCleared = !needsHr || hrDone;
    if (!sequential || (managerCleared && hrCleared)) {
      slots.push('finance');
    }
  }

  return slots;
}

function applyRequestReview(request, actor, decision, staff) {
  const status = String(decision || '').toLowerCase();
  if (status !== 'approved' && status !== 'rejected') {
    const err = new Error('Status must be approved or rejected');
    err.status = 400;
    throw err;
  }
  const slots = eligibleReviewSlots(actor, request, staff);
  if (!slots.length) {
    const err = new Error(
      isLoanRequest(request)
        ? 'Only the HR Manager, Financial Manager, or a CEO can review this loan — and only at their step'
        : 'Only the staff manager, HR Manager, or a CEO can review this request — and only at their step'
    );
    err.status = 403;
    throw err;
  }

  const next = {
    manager_reviewed_by: request.manager_reviewed_by || null,
    finance_reviewed_by: request.finance_reviewed_by || null,
    hr_reviewed_by: request.hr_reviewed_by || null,
    reviewed_by: actor.id,
    status: 'pending',
    finalized: false,
    slots,
  };

  if (status === 'rejected') {
    next.status = 'rejected';
    next.finalized = true;
    if (slots.includes('admin') || slots.includes('manager')) next.manager_reviewed_by = actor.id;
    if (slots.includes('admin') || slots.includes('finance')) next.finance_reviewed_by = actor.id;
    if (slots.includes('admin') || slots.includes('hr')) next.hr_reviewed_by = actor.id;
    return next;
  }

  if (slots.includes('admin')) {
    if (requestNeedsManager(request)) next.manager_reviewed_by = actor.id;
    if (requestNeedsFinance(request)) next.finance_reviewed_by = actor.id;
    if (requestNeedsHr(request)) next.hr_reviewed_by = actor.id;
    next.status = 'approved';
    next.finalized = true;
    return next;
  }

  if (slots.includes('manager')) next.manager_reviewed_by = actor.id;
  if (slots.includes('finance')) next.finance_reviewed_by = actor.id;
  if (slots.includes('hr')) next.hr_reviewed_by = actor.id;

  const mode = requestApprovalMode(request);
  if (!isLoanRequest(request) && mode === 'any') {
    if (next.manager_reviewed_by || next.hr_reviewed_by) {
      next.status = 'approved';
      next.finalized = true;
    }
  } else {
    const managerOk = !requestNeedsManager(request) || next.manager_reviewed_by;
    const financeOk = !requestNeedsFinance(request) || next.finance_reviewed_by;
    const hrOk = !requestNeedsHr(request) || next.hr_reviewed_by;
    if (managerOk && financeOk && hrOk) {
      next.status = 'approved';
      next.finalized = true;
    }
  }
  return next;
}

function describeRequestApproval(request) {
  if (request.status === 'approved') return 'Approved';
  if (request.status === 'rejected') return 'Rejected';

  const needsManagerEffective = request.needs_manager_approval !== false;
  const needsFinance = requestNeedsFinance(request);
  const needsHr = request.needs_hr_approval !== false;
  const managerDone = Boolean(request.manager_reviewed_by);
  const financeDone = Boolean(request.finance_reviewed_by);
  const hrDone = Boolean(request.hr_reviewed_by);

  if (isLoanRequest(request)) {
    if (needsManagerEffective && !managerDone) return 'Waiting for manager';
    if (needsHr && !hrDone) return 'Waiting for HR Manager';
    if (needsFinance && !financeDone) return 'Waiting for Financial Manager';
    return 'Pending';
  }

  const mode = requestApprovalMode(request);
  if (mode === 'any') {
    const waiting = [];
    if (needsManagerEffective && !managerDone) waiting.push('manager');
    if (needsHr && !hrDone) waiting.push('HR Manager');
    if (!waiting.length) return 'Pending';
    if (waiting.length > 1) return `Waiting for ${waiting.join(' or ')}`;
    return `Waiting for ${waiting[0]}`;
  }

  // Sequential leave / WFH: show only the current step so everyone knows where it sits.
  if (needsManagerEffective && !managerDone) return 'Waiting for manager';
  if (needsHr && !hrDone) return 'Waiting for HR Manager';
  return 'Pending';
}

function isPenaltyCategory(category) {
  return PENALTY_CATEGORIES.includes(String(category || '').toLowerCase());
}

function splitSalaryAdjustments(deductionRows = []) {
  const penalties = [];
  const deductions = [];
  for (const row of deductionRows) {
    if (isPenaltyCategory(row.category)) penalties.push(row);
    else deductions.push(row);
  }
  const sum = (rows) => roundMoney(rows.reduce((acc, r) => acc + (Number(r.amount) || 0), 0));
  return {
    penalties,
    deductions,
    penalties_total: sum(penalties),
    deductions_total: sum(deductions),
  };
}

module.exports = {
  DAYS_IN_MONTH,
  HOURS_IN_DAY,
  SHIFT_START_MINUTES,
  GRACE_END_MINUTES,
  LATE_QUARTER_END,
  LATE_HALF_END,
  PAID_EXCUSE_MAX_PER_MONTH,
  PAID_EXCUSE_MAX_HOURS,
  EARLY_LEAVE_MAX_PER_YEAR,
  ANNUAL_EXTENDED_NOTICE_DAYS,
  ANNUAL_EXTENDED_MIN_DURATION,
  TIMEZONE,
  EXCUSE_LEAVE_TYPES,
  roundMoney,
  dailyRate,
  hourlyRate,
  isExcuseLeaveType,
  isMissionLeaveType,
  leaveDoesNotAffectAttendance,
  normalizeExcuseLeaveType,
  parseHhMm,
  latenessFactor,
  absenceFactor,
  computeLatenessDeduction,
  computeAbsenceDeduction,
  computeUnpaidLeaveDeduction,
  computeUnpaidExcuseDeduction,
  leaveDayDeductionAmount,
  formatExcuseTime,
  excuseHoursFromTimes,
  assertExcuseWindow,
  assertMissionWindow,
  enumerateDateRange,
  cairoParts,
  addDaysIso,
  assertCasualTiming,
  assertAnnualNotice,
  assertEarlyLeaveTiming,
  assertExcuseTiming,
  HOLIDAY_ACCESS_MONTHS,
  monthsBetween,
  canRequestHolidays,
  leaveTypeRequiresHolidayAccess,
  leaveTypeRequiresApproval,
  leaveTypeApprovalMode,
  leaveApprovalPolicy,
  requestApprovalMode,
  HR_TEAM_ROLES,
  isHrTeamRole,
  isHrActingOnSelf,
  appliesSalaryImmediately,
  canEditStaffCompensation,
  assertCanEditStaffCompensation,
  assertHrNotEditingOwnCompensation,
  nextPayrollPeriod,
  dateCoveredByRanges,
  parseAttendanceRows,
  parseHtmlExcelTables,
  collapsePunchAttendance,
  fillMissingOfficeAbsences,
  isDoorPunchLog,
  normalizePersonId,
  matchAttendanceStaff,
  excelTimeToHhMm,
  toIsoDate,
  assertOriginalRecordsAttendanceTemplate,
  DEFAULT_ATTENDANCE_CHECKOUT,
  computeHalfDayDeduction,
  PENALTY_CATEGORIES,
  NO_OFFICE_ATTENDANCE_ROLES,
  OFFICE_ATTENDANCE_LINE_MANAGER_ROLES,
  LINE_MANAGER_ROLES,
  NO_STAFF_BENEFIT_ROLES,
  UNPAID_LEAVE_UNLIMITED,
  isUnpaidLeaveUnlimited,
  hasOfficeAttendance,
  isFieldOperationsRole,
  canRequestWfh,
  canRequestStaffBenefits,
  canRequestLoan,
  staffRequestPolicy,
  wfhRequestPolicy,
  isWfhRequest,
  loanRequestPolicy,
  isLoanRequest,
  departmentManagerRole,
  isLineManager,
  canViewAllStaffRequests,
  canSeeRequestHistory,
  eligibleReviewSlots,
  applyRequestReview,
  describeRequestApproval,
  isPenaltyCategory,
  splitSalaryAdjustments,
};
