'use strict';
/** Authentication routes: register (customer/provider), login, identity, 2FA, me. */
const express = require('express');
const { db, getSetting, encryptId } = require('../db');
const { hashPassword, verifyPassword, randomToken, createRateLimiter } = require('../security');
const { signToken, publicUser, requireAuth, otplib } = require('../auth');
const { notify } = require('../services/notifications');
const verification = require('../services/verification');
const router = express.Router();

const loginLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 10, keyFn: (req) => req.ip });

const PROVIDER_TYPES = ['driver', 'delivery', 'hotel', 'short_stay', 'apartment', 'property', 'other'];
const ID_TYPES = ['ghana_card', 'passport', 'drivers_licence', 'other'];

function validPassword(pw) {
  return typeof pw === 'string' && pw.length >= 8 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw);
}

// POST /api/auth/register — customer or provider
router.post('/register', (req, res) => {
  const { email, password, full_name, phone, role, provider_type, business_name, identity_type, identity_number } = req.body || {};
  if (!email || !password || !full_name) return res.status(400).json({ error: 'email, password and full_name are required' });
  if (!validPassword(password)) return res.status(400).json({ error: 'Password must be at least 8 characters with upper, lower and a number' });
  const normEmail = String(email).toLowerCase().trim();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normEmail);
  if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

  const isProvider = role === 'provider';
  if (isProvider && !PROVIDER_TYPES.includes(provider_type)) return res.status(400).json({ error: 'Invalid provider_type' });

  const info = db.prepare('INSERT INTO users (email, phone, full_name, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?)')
    .run(normEmail, phone || null, full_name, hashPassword(password), isProvider ? 'provider' : 'customer', 'ACTIVE');
  const userId = info.lastInsertRowid;

  if (isProvider) {
    db.prepare('INSERT INTO providers (user_id, provider_type, business_name, status) VALUES (?, ?, ?, ?)')
      .run(userId, provider_type, business_name || null, 'PENDING_VERIFICATION');
    if (identity_type && identity_number) {
      verification.submitIdentity(userId, { identityType: identity_type, identityNumber: encryptId(identity_number), docPath: null });
    }
    notify(userId, 'account', 'Provider account created', 'Your provider account is pending verification.');
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const token = signToken(user);
  res.status(201).json({ token, user: publicUser(user) });
});

// POST /api/auth/identity — submit identity for verification
router.post('/identity', requireAuth, (req, res) => {
  const { identity_type, identity_number } = req.body || {};
  if (!identity_type || !identity_number) return res.status(400).json({ error: 'identity_type and identity_number are required' });
  if (!ID_TYPES.includes(identity_type)) return res.status(400).json({ error: 'Invalid identity_type' });
  const result = verification.submitIdentity(req.user.id, { identityType: identity_type, identityNumber: encryptId(identity_number), docPath: null });
  if (result.error) return res.status(400).json(result);
  res.json({ status: result.status });
});

// POST /api/auth/login
router.post('/login', loginLimiter, (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase().trim());
  if (!u || !verifyPassword(password, u.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
  if (u.status !== 'ACTIVE') return res.status(403).json({ error: 'Account is not active' });
  db.prepare('UPDATE users SET last_login_at = datetime(\'now\') WHERE id = ?').run(u.id);
  const token = signToken(u);
  res.json({ token, user: publicUser(u) });
});

// POST /api/auth/logout
router.post('/logout', requireAuth, (req, res) => {
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// POST /api/auth/me/2fa/setup — generate TOTP secret (customer-side optional)
router.post('/me/2fa/setup', requireAuth, async (req, res) => {
  const secret = otplib.generateSecret();
  const otpauth_url = otplib.generateURI({ secret, label: req.user.email, issuer: 'PANDOX ODA CONNECT' });
  res.json({ secret, otpauth_url });
});

// POST /api/auth/me/2fa/enable
router.post('/me/2fa/enable', requireAuth, async (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'token is required' });
  const secret = req.user.two_factor_secret;
  if (!secret) return res.status(400).json({ error: 'Run 2FA setup first' });
  const valid = await otplib.verify({ token, secret });
  if (!valid) return res.status(400).json({ error: 'Invalid code' });
  db.prepare('UPDATE users SET two_factor_enabled = 1 WHERE id = ?').run(req.user.id);
  res.json({ ok: true });
});

// POST /api/auth/me/2fa/disable
router.post('/me/2fa/disable', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL WHERE id = ?').run(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
