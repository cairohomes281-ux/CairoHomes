export const DAYS_IN_MONTH = 30;
export const HOURS_IN_DAY = 24;
export const PAID_EXCUSE_MAX_PER_MONTH = 2;
export const PAID_EXCUSE_MAX_HOURS = 2;
/** @deprecated */
export const EARLY_LEAVE_MAX_PER_YEAR = PAID_EXCUSE_MAX_PER_MONTH;

export function dailyRate(baseSalary) {
  return Math.round(((Number(baseSalary) || 0) / DAYS_IN_MONTH + Number.EPSILON) * 100) / 100;
}

export function hourlyRate(baseSalary) {
  return Math.round((dailyRate(baseSalary) / HOURS_IN_DAY + Number.EPSILON) * 100) / 100;
}

export const LEAVE_TYPE_LABELS = {
  casual: 'Casual',
  annual: 'Annual',
  early_leave: 'Paid excuse',
  paid_excuse: 'Paid excuse',
  unpaid_excuse: 'Unpaid excuse',
  sick: 'Sick leave',
  holiday: 'Holiday',
  day_off: 'Day off',
  unpaid: 'Unpaid',
  mission: 'Mission',
};

export function formatUnpaidLeaveAvailable(leaveSnap) {
  if (leaveSnap?.unpaid_unlimited) return 'Unlimited';
  const n = Number(leaveSnap?.unpaid_available);
  return Number.isFinite(n) ? n : 'Unlimited';
}

export function isExcuseLeaveType(leaveType) {
  const t = String(leaveType || '');
  return t === 'paid_excuse' || t === 'unpaid_excuse' || t === 'early_leave';
}

export function isMissionLeaveType(leaveType) {
  return String(leaveType || '') === 'mission';
}

/** Day + time window requests (excuses and missions). */
export function isTimedLeaveType(leaveType) {
  return isExcuseLeaveType(leaveType) || isMissionLeaveType(leaveType);
}

export function requestableLeaveTypes(canRequestHolidays) {
  const unpaid = { value: 'unpaid', label: 'Unpaid leave (manager then HR)' };
  const paidExcuse = { value: 'paid_excuse', label: 'Paid excuse (2/month, max 2h · manager then HR)' };
  const unpaidExcuse = { value: 'unpaid_excuse', label: 'Unpaid excuse (hourly · manager then HR)' };
  const mission = { value: 'mission', label: 'Mission (paid time · manager then HR)' };
  if (canRequestHolidays) {
    return [
      { value: 'casual', label: 'Casual (manager then HR)' },
      { value: 'annual', label: 'Annual (manager then HR)' },
      paidExcuse,
      unpaidExcuse,
      mission,
      unpaid,
    ];
  }
  return [paidExcuse, unpaidExcuse, mission, unpaid];
}

export function computeAttendanceAmount(baseSalary, { status, check_in } = {}) {
  const rate = dailyRate(baseSalary);
  const st = String(status || '').toLowerCase();
  if (st === 'on_time') return 0;
  if (st === 'no_show') return Math.round((rate * 2 + Number.EPSILON) * 100) / 100;
  if (st !== 'late') return 0;
  const text = String(check_in || '').trim();
  const m = text.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  let factor = 1;
  if (minutes <= 11 * 60 + 15) factor = 0;
  else if (minutes <= 11 * 60 + 30) factor = 0.25;
  else if (minutes <= 12 * 60) factor = 0.5;
  return Math.round((rate * factor + Number.EPSILON) * 100) / 100;
}

export const DEDUCTION_TYPE_LABELS = {
  lateness: 'Lateness',
  delay: 'Lateness',
  absence: 'Absence',
  performance: 'Performance',
  advance: 'Advance',
  other: 'Other',
  penalty: 'Penalty',
  bonus: 'Bonus',
  loan: 'Loan',
  wfh: 'Work from home',
};
