const crypto = require('crypto');
const { query } = require('../config/db');

const MAX_ATTEMPTS = 100;

const ROLE_PREFIX = {
  admin: 'A',
  reservations: 'R',
  reservations_web: 'W',
  reservations_manual: 'M',
  reservations_manager: 'G',
  unit_acquisition_agent: 'C',
  unit_acquisition_manager: 'Q',
  operations: 'P',
  operations_supervisor: 'V',
  housekeeping: 'K',
  housekeeping_supervisor: 'L',
  resale: 'S',
  resale_manager: 'J',
  finance: 'F',
  finance_manager: 'FM',
  hr: 'H',
  hr_supervisor: 'U',
  owners_relations: 'N',
  owner: 'O',
  marketing_pr: 'B',
  web_developer: 'D',
};

function randomDigitString(length) {
  return Array.from({ length }, () => String(Math.floor(Math.random() * 10))).join('');
}

function isValidPattern(digits) {
  const value = String(digits || '');
  for (let i = 0; i < value.length - 2; i += 1) {
    if (value[i] === value[i + 1] && value[i] === value[i + 2]) return false;
  }
  return true;
}

async function generateUniqueStaffCode(role) {
  const prefix = ROLE_PREFIX[role] || 'X';
  for (let attempts = 0; attempts < MAX_ATTEMPTS; attempts += 1) {
    const digits = randomDigitString(4);
    if (!isValidPattern(digits)) continue;
    const code = `${prefix}${digits}`;
    const { rows } = await query(`SELECT id FROM staff_users WHERE staff_code = $1`, [code]);
    if (!rows[0]) return code;
  }
  throw new Error('Unable to generate a unique staff ID');
}

function normalizeStaffCode(value) {
  const code = String(value || '').trim();
  return code || null;
}

async function assertStaffCodeAvailable(code, exceptId = null) {
  if (!code) return;
  const params = [code];
  let sql = `SELECT id FROM staff_users WHERE lower(staff_code) = lower($1)`;
  if (exceptId) {
    params.push(exceptId);
    sql += ` AND id <> $2`;
  }
  const { rows } = await query(sql, params);
  if (rows[0]) {
    const err = new Error('This staff ID is already in use');
    err.status = 409;
    throw err;
  }
}

/** One-time temporary password that meets policy (shown once to the admin). */
function generateTempPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const pick = (alphabet, n) =>
    Array.from({ length: n }, () => alphabet[crypto.randomInt(0, alphabet.length)]).join('');
  const raw = `${pick(upper, 2)}${pick(lower, 4)}${pick(digits, 2)}${pick(upper, 1)}${pick(lower, 1)}`;
  return raw
    .split('')
    .sort(() => crypto.randomInt(0, 3) - 1)
    .join('');
}

/** @deprecated Use generateTempPassword(); kept for scripts that print a one-off value. */
const TEMP_PASSWORD = null;

function isPasswordPolicyExempt(_email) {
  return false;
}

function passwordPolicyOk(password, _email) {
  const value = String(password || '');
  return value.length >= 8 && /[A-Z]/.test(value) && /[a-z]/.test(value);
}

async function applyExemptUserPasswords() {
  // Intentionally no-op: hardcoded password overrides were removed for security.
}

function passwordPolicyMessage() {
  return 'Password must be at least 8 characters and include uppercase and lowercase letters';
}

function getPasswordPolicyChecks(password) {
  const value = String(password || '');
  return {
    minLength: value.length >= 8,
    uppercase: /[A-Z]/.test(value),
    lowercase: /[a-z]/.test(value),
  };
}

module.exports = {
  TEMP_PASSWORD,
  generateTempPassword,
  ROLE_PREFIX,
  generateUniqueStaffCode,
  normalizeStaffCode,
  assertStaffCodeAvailable,
  isPasswordPolicyExempt,
  passwordPolicyOk,
  passwordPolicyMessage,
  getPasswordPolicyChecks,
  applyExemptUserPasswords,
};
