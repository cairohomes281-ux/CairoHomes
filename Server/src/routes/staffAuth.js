const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { authStaff } = require('../middleware/auth');
const {
  isPasswordPolicyExempt,
  passwordPolicyOk,
  passwordPolicyMessage,
} = require('../lib/staffIdentity');
const { normalizeOwnerPhone, ownerPhoneLoginVariants } = require('../lib/ownerPhone');
const { staffTokenVersion } = require('../lib/staffAuthSessions');
const { pageAccessFor, actingPagesFor } = require('../lib/rolePages');

const router = express.Router();

const STAFF_PUBLIC_FIELDS = `
  id, username, email, full_name, role, is_active,
  sales_commission_pct, petty_cash_location,
  staff_code, base_salary, pending_base_salary, salary_change_status,
  is_first_login, COALESCE(auth_token_version, 0)::int AS auth_token_version,
  custom_role_id,
  (SELECT r.name FROM staff_roles r WHERE r.id = custom_role_id) AS custom_role_name,
  (SELECT r.pages FROM staff_roles r WHERE r.id = custom_role_id) AS custom_role_pages,
  (SELECT rp.pages FROM staff_role_pages rp WHERE rp.role = staff_users.role) AS role_pages
`;

function toPublicUser(row) {
  if (!row) return null;
  const user = { ...row, role: row.base_role || row.role };
  const pageAccess = pageAccessFor(user);
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    full_name: row.full_name,
    role: user.role,
    page_access: pageAccess,
    acting_pages: actingPagesFor(user, pageAccess),
    is_active: row.is_active,
    sales_commission_pct: row.sales_commission_pct,
    petty_cash_location: row.petty_cash_location,
    staff_code: row.staff_code,
    base_salary: row.base_salary,
    pending_base_salary: row.pending_base_salary,
    salary_change_status: row.salary_change_status || 'none',
    is_first_login:
      Boolean(Number(row.is_first_login)) && !isPasswordPolicyExempt(row.email),
    custom_role_id: row.custom_role_id || null,
    custom_role_name: row.custom_role_id ? row.custom_role_name || null : null,
    custom_role_pages:
      row.custom_role_id && Array.isArray(row.custom_role_pages) ? row.custom_role_pages : null,
  };
}

function signStaff(user) {
  return jwt.sign(
    {
      kind: 'staff',
      sub: user.id,
      role: user.role,
      tv: staffTokenVersion(user),
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

router.post('/login', async (req, res, next) => {
  try {
    const identity = String(req.body.username || req.body.email || req.body.identity || '').trim();
    const { password } = req.body;
    if (!identity || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const phoneVariants = ownerPhoneLoginVariants(identity);
    const canonicalPhone = normalizeOwnerPhone(identity);

    const { rows } = await query(
      `SELECT s.*, r.name AS custom_role_name, r.pages AS custom_role_pages,
              rp.pages AS role_pages
       FROM staff_users s
       LEFT JOIN staff_roles r ON r.id = s.custom_role_id
       LEFT JOIN staff_role_pages rp ON rp.role = s.role
       WHERE is_active = 1
         AND (
           lower(username) = lower($1)
           OR lower(COALESCE(email, '')) = lower($1)
           OR lower(COALESCE(staff_code, '')) = lower($1)
           OR ($2::text IS NOT NULL AND username = $2)
           OR ($3::text[] IS NOT NULL AND cardinality($3::text[]) > 0 AND username = ANY($3::text[]))
         )
       LIMIT 1`,
      [identity, canonicalPhone, phoneVariants.length ? phoneVariants : null]
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const publicUser = toPublicUser(user);
    const token = signStaff(user);
    const forcePasswordChange = publicUser.is_first_login;

    res.json({
      token,
      user: publicUser,
      forcePasswordChange,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/me', authStaff, (req, res) => {
  res.json({ user: toPublicUser(req.user) });
});

router.patch('/change-password', authStaff, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password required' });
    }
    if (!passwordPolicyOk(newPassword, req.user.email)) {
      return res.status(400).json({ error: passwordPolicyMessage() });
    }

    const { rows } = await query('SELECT password_hash FROM staff_users WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
      return res.status(400).json({ error: 'Current password incorrect' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    const { rows: updated } = await query(
      `UPDATE staff_users
       SET password_hash = $1,
           is_first_login = 0,
           auth_token_version = COALESCE(auth_token_version, 0) + 1,
           updated_at = now()
       WHERE id = $2
       RETURNING ${STAFF_PUBLIC_FIELDS}`,
      [hash, req.user.id]
    );
    const publicUser = toPublicUser(updated[0]);
    const token = signStaff(updated[0]);

    res.json({ ok: true, user: publicUser, token });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
