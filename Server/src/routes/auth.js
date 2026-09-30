const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { query } = require('../config/db');
const { getServiceClient, getAnonClient } = require('../config/supabase');
const { authGuest } = require('../middleware/auth');

const { passwordPolicyOk, passwordPolicyMessage } = require('../lib/staffIdentity');
const { sendPasswordResetEmail } = require('../services/guestEmails');

const router = express.Router();

function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function signGuest(user) {
  return jwt.sign(
    { kind: 'guest', sub: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function signGuestRefresh(user) {
  return jwt.sign(
    { kind: 'guest_refresh', sub: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function supabaseAuthEnabled() {
  return Boolean(
    process.env.SUPABASE_URL &&
      process.env.SUPABASE_URL.includes('http') &&
      !process.env.SUPABASE_URL.includes('xxxxx') &&
      (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)
  );
}

async function upsertProfile(user, extras = {}) {
  await query(
    `INSERT INTO profiles (id, email, full_name, phone, password_hash)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET
       email = EXCLUDED.email,
       full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
       phone = COALESCE(EXCLUDED.phone, profiles.phone),
       password_hash = COALESCE(EXCLUDED.password_hash, profiles.password_hash),
       updated_at = now()`,
    [
      user.id,
      user.email || extras.email || '',
      extras.full_name || user.user_metadata?.full_name || null,
      extras.phone || user.phone || null,
      extras.password_hash || null,
    ]
  );
}

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone || null,
    user_metadata: { full_name: row.full_name },
  };
}


async function localSignUp({ email, password, full_name, phone }) {
  if (!email || !password) {
    const err = new Error('Email and password are required');
    err.status = 400;
    throw err;
  }
  if (!passwordPolicyOk(password, email)) {
    const err = new Error(passwordPolicyMessage());
    err.status = 400;
    throw err;
  }
  const { rows: existing } = await query(
    `SELECT id FROM profiles WHERE lower(email) = lower($1)`,
    [email]
  );
  if (existing[0]) {
    const err = new Error('Email already registered');
    err.status = 400;
    throw err;
  }
  const id = crypto.randomUUID();
  const password_hash = await bcrypt.hash(password, 10);
  await query(
    `INSERT INTO profiles (id, email, full_name, phone, password_hash)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, email, full_name || null, phone || null, password_hash]
  );
  const user = { id, email, phone: phone || null, user_metadata: { full_name } };
  return {
    user,
    accessToken: signGuest(user),
    refreshToken: signGuestRefresh(user),
  };
}

async function localSignIn({ email, password }) {
  const { rows } = await query(
    `SELECT * FROM profiles WHERE lower(email) = lower($1)`,
    [email]
  );
  const row = rows[0];
  if (!row?.password_hash || !(await bcrypt.compare(password, row.password_hash))) {
    const err = new Error('Invalid credentials');
    err.status = 401;
    throw err;
  }
  const user = publicUser(row);
  return {
    user,
    accessToken: signGuest(user),
    refreshToken: signGuestRefresh(user),
  };
}

router.post('/sign-up', async (req, res, next) => {
  try {
    const { email, password, full_name, phone } = req.body;

    if (!passwordPolicyOk(password, email)) {
      return res.status(400).json({ error: passwordPolicyMessage() });
    }

    if (supabaseAuthEnabled()) {
      const supabase = getServiceClient() || getAnonClient();
      const { data, error } = await supabase.auth.admin
        .createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name, phone },
        })
        .catch(async () =>
          supabase.auth.signUp({ email, password, options: { data: { full_name, phone } } })
        );
      if (error) return res.status(400).json({ error: error.message });
      const user = data.user;
      if (user) await upsertProfile(user, { full_name, phone, email });
      return res.json({
        user,
        accessToken: data.session?.access_token || (user ? signGuest(user) : null),
        refreshToken: data.session?.refresh_token || null,
      });
    }

    const result = await localSignUp({ email, password, full_name, phone });
    res.status(201).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post('/sign-in', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (supabaseAuthEnabled()) {
      const supabase = getAnonClient();
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return res.status(401).json({ error: error.message });
      await upsertProfile(data.user);
      return res.json({
        user: data.user,
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
      });
    }

    const result = await localSignIn({ email, password });
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post('/send-otp', async (req, res) => {
  if (!supabaseAuthEnabled()) {
    return res.status(501).json({
      error: 'Phone OTP requires Supabase Auth keys. Use email/password when running with DATABASE_URL only.',
    });
  }
  try {
    const { phone } = req.body;
    const supabase = getAnonClient();
    const { error } = await supabase.auth.signInWithOtp({ phone, options: { channel: 'sms' } });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/verify-otp', async (req, res) => {
  if (!supabaseAuthEnabled()) {
    return res.status(501).json({
      error: 'Phone OTP requires Supabase Auth keys. Use email/password when running with DATABASE_URL only.',
    });
  }
  try {
    const { phone, token } = req.body;
    const supabase = getAnonClient();
    const { data, error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
    if (error) return res.status(400).json({ error: error.message });
    await upsertProfile(data.user);
    res.json({
      user: data.user,
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });

    if (supabaseAuthEnabled()) {
      const supabase = getAnonClient();
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
      if (error) return res.status(401).json({ error: error.message });
      return res.json({
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
      });
    }

    const payload = jwt.verify(refreshToken, process.env.JWT_SECRET);
    if (payload.kind !== 'guest_refresh') {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    const user = { id: payload.sub, email: payload.email };
    res.json({
      accessToken: signGuest(user),
      refreshToken: signGuestRefresh(user),
    });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    next(err);
  }
});

router.post('/forgot-password', async (req, res, next) => {
  
  
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) return res.json({ ok: true });

    const { rows: staffRows } = await query(
      `SELECT id, role FROM staff_users
       WHERE lower(COALESCE(email, '')) = lower($1)
         AND COALESCE(is_active, 1) = 1
       LIMIT 1`,
      [email]
    );
    const staff = staffRows[0];
    if (staff && String(staff.role || '').toLowerCase() !== 'owner') {
      return res.json({ ok: true, staff_contact_admin: true });
    }

    if (supabaseAuthEnabled()) {
      const supabase = getAnonClient();
      await supabase.auth
        .resetPasswordForEmail(email, {
          redirectTo: `${process.env.FRONTEND_URL}/reset-password`,
        })
        .catch(() => {});
    }

    const { rows } = await query(
      `SELECT id, email, full_name, password_hash
       FROM profiles
       WHERE lower(email) = lower($1)
       LIMIT 1`,
      [email]
    );
    const profile = rows[0];

    if (profile?.password_hash) {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashResetToken(token);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await query(
        `UPDATE profiles
         SET password_reset_token_hash = $1,
             password_reset_expires_at = $2,
             updated_at = now()
         WHERE id = $3`,
        [tokenHash, expiresAt.toISOString(), profile.id]
      );

      const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';
      const resetUrl = `${frontend.replace(/\/$/, '')}/reset-password?token=${token}`;
      try {
        await sendPasswordResetEmail({
          email: profile.email,
          fullName: profile.full_name,
          resetUrl,
        });
      } catch (emailErr) {
        console.error('[email] Password reset email failed:', emailErr.message);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password', async (req, res, next) => {
  try {
    const token = String(req.body?.token || '').trim();
    const newPassword = req.body?.password || req.body?.newPassword;
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    const tokenHash = hashResetToken(token);
    const { rows } = await query(
      `SELECT id, email, full_name, phone
       FROM profiles
       WHERE password_reset_token_hash = $1
         AND password_reset_expires_at IS NOT NULL
         AND password_reset_expires_at > now()
       LIMIT 1`,
      [tokenHash]
    );
    if (!rows[0]) {
      return res.status(400).json({ error: 'Reset link is invalid or has expired' });
    }
    if (!passwordPolicyOk(newPassword, rows[0].email)) {
      return res.status(400).json({ error: passwordPolicyMessage() });
    }

    const password_hash = await bcrypt.hash(newPassword, 10);
    await query(
      `UPDATE profiles
       SET password_hash = $1,
           password_reset_token_hash = NULL,
           password_reset_expires_at = NULL,
           updated_at = now()
       WHERE id = $2`,
      [password_hash, rows[0].id]
    );

    const user = publicUser(rows[0]);
    res.json({
      ok: true,
      user,
      accessToken: signGuest(user),
      refreshToken: signGuestRefresh(user),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/me', authGuest, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, email, full_name, phone, home_points, created_at FROM profiles WHERE id = $1`,
      [req.guest.id]
    );
    res.json({ user: req.guest, profile: rows[0] || null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
