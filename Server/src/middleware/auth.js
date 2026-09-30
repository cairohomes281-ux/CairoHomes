const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { getServiceClient } = require('../config/supabase');
const { isPasswordPolicyExempt } = require('../lib/staffIdentity');
const { tokenVersionMatches } = require('../lib/staffAuthSessions');

async function authStaff(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.kind && payload.kind !== 'staff') {
      return res.status(401).json({ error: 'Staff token required' });
    }

    const { rows } = await query(
      `SELECT s.id, s.username, s.email, s.full_name, s.role, s.is_active, s.sales_commission_pct,
              s.petty_cash_location, s.staff_code, s.base_salary, s.pending_base_salary,
              s.salary_change_status, s.is_first_login,
              COALESCE(s.auth_token_version, 0)::int AS auth_token_version,
              s.custom_role_id, r.name AS custom_role_name, r.pages AS custom_role_pages
       FROM staff_users s
       LEFT JOIN staff_roles r ON r.id = s.custom_role_id
       WHERE s.id = $1`,
      [payload.sub || payload.id]
    );
    if (!rows[0] || !rows[0].is_active) return res.status(401).json({ error: 'Unauthorized' });
    if (!tokenVersionMatches(payload, rows[0])) {
      return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    }
    req.user = {
      ...rows[0],
      is_first_login:
        Boolean(Number(rows[0].is_first_login)) && !isPasswordPolicyExempt(rows[0].email),
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (roles.length && !roles.includes(req.user.role) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}


function requirePasswordChanged(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const path = String(req.path || req.originalUrl || '');
  if (req.user.is_first_login && !path.includes('change-password')) {
    return res.status(423).json({
      error: 'Password change required before continuing',
      forcePasswordChange: true,
    });
  }
  next();
}

async function authGuest(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (payload.kind === 'guest') {
        req.guest = { id: payload.sub, email: payload.email };
        return next();
      }
    } catch {}

    
    const supabase = getServiceClient();
    if (
      supabase &&
      process.env.SUPABASE_URL &&
      !String(process.env.SUPABASE_URL).includes('xxxxx')
    ) {
      const { data, error } = await supabase.auth.getUser(token);
      if (!error && data?.user) {
        req.guest = data.user;
        return next();
      }
    }

    return res.status(401).json({ error: 'Invalid token' });
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function optionalGuest(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();
  authGuest(req, { status: () => ({ json: () => {} }) }, () => next());
}

module.exports = { authStaff, authGuest, optionalGuest, requireRoles, requirePasswordChanged };
