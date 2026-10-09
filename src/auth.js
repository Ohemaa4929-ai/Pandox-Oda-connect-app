'use strict';
/**
 * Authentication & authorization — JWT sessions, admin RBAC, 2FA (TOTP), audit.
 * All secrets come from environment variables — never hardcoded.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const otplib = require('otplib');
const { db } = require('./db');
const config = require('./config');
const { hashPassword, verifyPassword, randomToken, sha256 } = require('./security');

const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12-hour admin sessions

const ADMIN_ROLES = ['SUPER_ADMIN', 'FINANCE_ADMIN', 'VERIFICATION_ADMIN', 'SUPPORT_ADMIN', 'DISPUTE_ADMIN', 'CONTENT_ADMIN', 'TECH_ADMIN'];

function signToken(user) {
  return jwt.sign({ uid: user.id, role: user.role }, config.sessionSecret, { expiresIn: SESSION_TTL_SECONDS });
}

function publicUser(u) {
  return {
    id: u.id, email: u.email, phone: u.phone, full_name: u.full_name, role: u.role,
    status: u.status, email_verified: !!u.email_verified, phone_verified: !!u.phone_verified,
    identity_type: u.identity_type, identity_status: u.identity_status,
    two_factor_enabled: !!u.two_factor_enabled, created_at: u.created_at
  };
}

function publicAdmin(a, u) {
  return {
    id: a.id, user_id: a.user_id, role: a.role, status: a.status,
    email: u ? u.email : null, full_name: u ? u.full_name : null,
    two_factor_enabled: u ? !!u.two_factor_enabled : false,
    last_login_at: u ? u.last_login_at : null
  };
}

/** Require a valid user session (Bearer token). */
function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(token, config.sessionSecret);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.uid);
    if (!u || u.status !== 'ACTIVE') return res.status(401).json({ error: 'Account inactive or not found' });
    req.user = u;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

/** Require an admin session (Bearer token issued by /api/admin/auth/login). */
function requireAdmin(...roles) {
  return (req, res, next) => {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    try {
      const payload = jwt.verify(token, config.sessionSecret);
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.uid);
      if (!u || u.status !== 'ACTIVE') return res.status(401).json({ error: 'Account inactive or not found' });
      const a = db.prepare('SELECT * FROM admin_users WHERE user_id = ?').get(u.id);
      if (!a || a.status !== 'ACTIVE') return res.status(403).json({ error: 'Admin access required' });
      if (roles.length && !roles.includes(a.role) && a.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ error: 'Insufficient role permissions' });
      }
      req.user = u;
      req.admin = a;
      next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
  };
}

/** Record an admin action in the audit log. */
function audit(adminId, action, targetType, targetId, prev, nextState, ip) {
  db.prepare('INSERT INTO audit_logs (admin_id, action, target_type, target_id, previous_state, new_state, ip) VALUES (?,?,?,?,?,?,?)')
    .run(adminId, action, targetType || null, targetId != null ? String(targetId) : null,
      prev != null ? JSON.stringify(prev) : null, nextState != null ? JSON.stringify(nextState) : null, ip || null);
}

/** Create an admin session: sign a JWT and record its hash for session management / revocation. */
function createAdminSession(user, ip) {
  const token = signToken(user);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  db.prepare('INSERT INTO admin_sessions (user_id, token_hash, ip, expires_at) VALUES (?, ?, ?, ?)')
    .run(user.id, sha256(token), ip || null, expiresAt);
  return token;
}

function revokeAdminSession(userId, token) {
  db.prepare(`UPDATE admin_sessions SET revoked_at = datetime('now') WHERE user_id = ? AND token_hash = ? AND revoked_at IS NULL`)
    .run(userId, sha256(token));
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM platform_settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

/** Platform gate: maintenance mode blocks non-admin API traffic. */
function checkPlatformGate(req, res, next) {
  if (req.path.startsWith('/admin')) return next();
  if (getSetting('maintenance_mode') === '1') return res.status(503).json({ error: 'Platform is in maintenance mode' });
  next();
}

module.exports = {
  hashPassword, verifyPassword, signToken, publicUser, publicAdmin,
  requireAuth, requireAdmin, audit, createAdminSession, revokeAdminSession,
  getSetting, checkPlatformGate, ADMIN_ROLES, SESSION_TTL_SECONDS, otplib
};
