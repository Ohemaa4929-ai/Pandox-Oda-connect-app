'use strict';
/** Admin routes — owner control center, moderation, finance, audit. */
const express = require('express');
const bcrypt = require('bcryptjs');
const { db, getSetting, setSetting, getControl, setControl } = require('../db');
const config = require('../config');
const { requireAuth, requireAdmin, hashToken, createToken } = require('../auth');
const { audit } = require('../services/audit');
const { notify } = require('../services/notifications');
const verification = require('../services/verification');
const payments = require('../services/payments');
const router = express.Router();

function safeUser(u) { if (!u) return null; const { password_hash, two_factor_secret, ...rest } = u; return rest; }

/* ---------------- ADMIN AUTH ---------------- */
router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!u || !['SUPER_ADMIN', 'admin', 'owner'].includes(u.role)) return res.status(401).json({ error: 'Invalid admin credentials' });
  if (u.status !== 'ACTIVE') return res.status(403).json({ error: 'Account inactive' });
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid admin credentials' });
  const token = createToken(u);
  db.prepare(`INSERT INTO admin_sessions (user_id, token_hash, ip, expires_at) VALUES (?, ?, ?, datetime('now', '+8 hours'))`)
    .run(u.id, hashToken(token), req.ip);
  res.json({ token, admin: safeUser(u) });
});

router.get('/auth/me', requireAdmin(), (req, res) => res.json({ admin: safeUser(req.user) }));
router.post('/auth/logout', requireAdmin(), (req, res) => {
  if (req.token) db.prepare('UPDATE admin_sessions SET revoked_at = datetime(\'now\') WHERE token_hash = ?').run(hashToken(req.token));
  res.json({ message: 'Logged out' });
});

/* ---------------- DASHBOARD ---------------- */
router.get('/dashboard', requireAdmin(), (req, res) => {
  const stats = {
    total_users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
    total_providers: db.prepare('SELECT COUNT(*) c FROM providers').get().c,
    pending_verifications: db.prepare("SELECT COUNT(*) c FROM users WHERE identity_status IN ('PENDING','UNDER_REVIEW')").get().c,
    pending_listings: db.prepare("SELECT COUNT(*) c FROM listings WHERE status = 'PENDING'").get().c,
    total_bookings: db.prepare('SELECT COUNT(*) c FROM bookings').get().c,
    pending_bookings: db.prepare("SELECT COUNT(*) c FROM bookings WHERE status = 'PENDING'").get().c,
    open_disputes: db.prepare("SELECT COUNT(*) c FROM disputes WHERE status IN ('OPEN','UNDER_REVIEW')").get().c,
    revenue: db.prepare("SELECT COALESCE(SUM(amount),0) total FROM financial_transactions WHERE status = 'SUCCESS'").get().total,
    pending_manual_payments: db.prepare("SELECT COUNT(*) c FROM manual_payment_submissions WHERE status = 'PAID_REPORTED'").get().c
  };
  res.json({ stats });
});

/* ---------------- USER MANAGEMENT ---------------- */
router.get('/users', requireAdmin(), (req, res) => {
  const { role, status, q } = req.query;
  let sql = `SELECT id, email, phone, full_name, role, status, identity_status, created_at, last_login_at FROM users WHERE 1=1`;
  const params = [];
  if (role) { sql += ' AND role = ?'; params.push(role); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (q) { sql += ' AND (email LIKE ? OR full_name LIKE ? OR phone LIKE ?)'; const x = `%${q}%`; params.push(x, x, x); }
  sql += ' ORDER BY created_at DESC LIMIT 200';
  res.json({ users: db.prepare(sql).all(...params) });
});

router.get('/users/:id', requireAdmin(), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  res.json({ user: safeUser(u), provider: db.prepare('SELECT * FROM providers WHERE user_id = ?').get(u.id) || null });
});

router.post('/users/:id/status', requireAdmin(), (req, res) => {
  const { status } = req.body || {};
  if (!['ACTIVE', 'SUSPENDED', 'DEACTIVATED'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  db.prepare('UPDATE users SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, u.id);
  audit(req.user.id, status === 'SUSPENDED' ? 'USER_SUSPENDED' : 'USER_STATUS_CHANGED', 'user', u.id, { status: u.status }, { status });
  notify(u.id, 'account', status === 'SUSPENDED' ? 'Account suspended' : 'Account status updated', `Your account status is now ${status}.`);
  res.json({ message: 'User ' + status });
});

/* ---------------- PROVIDERS ---------------- */
router.get('/providers', requireAdmin(), (req, res) => {
  const { status, type } = req.query;
  let sql = `SELECT p.*, u.email, u.full_name, u.phone, u.identity_type, u.identity_status, u.created_at
    FROM providers p JOIN users u ON u.id = p.user_id WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND p.status = ?'; params.push(status); }
  if (type) { sql += ' AND p.provider_type = ?'; params.push(type); }
  sql += ' ORDER BY p.created_at DESC LIMIT 200';
  res.json({ providers: db.prepare(sql).all(...params) });
});

router.post('/providers/:id/verify', requireAdmin(), (req, res) => {
  const { action, note } = req.body || {};
  if (!['APPROVED', 'REJECTED'].includes(action)) return res.status(400).json({ error: 'action must be APPROVED or REJECTED' });
  const p = db.prepare('SELECT * FROM providers WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Provider not found' });
  db.prepare('UPDATE providers SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(action, p.id);
  audit(req.user.id, 'PROVIDER_' + action, 'provider', p.id, { status: p.status }, { status: action, note: note || null });
  notify(p.user_id, 'verification', 'Provider application ' + action.toLowerCase(), note || `Your provider application was ${action.toLowerCase()}.`);
  res.json({ message: 'Provider ' + action });
});

router.post('/providers/:id/status', requireAdmin(), (req, res) => {
  const { status } = req.body || {};
  const allowed = ['PENDING_VERIFICATION', 'APPROVED', 'REJECTED', 'SUSPENDED'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const p = db.prepare('SELECT * FROM providers WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Provider not found' });
  db.prepare('UPDATE providers SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, p.id);
  audit(req.user.id, 'PROVIDER_' + status, 'provider', p.id, { status: p.status }, { status });
  notify(p.user_id, 'verification', 'Provider status updated', 'Your provider account is now ' + status + '.');
  res.json({ message: 'Provider ' + status });
});

/* ---------------- ID VERIFICATION ---------------- */
router.get('/verifications', requireAdmin(), (req, res) => {
  const rows = db.prepare(`SELECT u.id, u.full_name, u.email, u.phone, u.identity_type, u.identity_status, u.created_at FROM users u WHERE u.identity_status != 'NONE' ORDER BY u.created_at DESC LIMIT 200`).all();
  res.json({ verifications: rows });
});
router.post('/verifications/:id/review', requireAdmin(), (req, res) => {
  const { action, note } = req.body || {};
  if (!['APPROVED', 'REJECTED', 'REQUEST_RESUBMISSION'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const result = verification.reviewIdentity(u.id, action, note || null, req.user.id);
  if (result.error) return res.status(400).json(result);
  audit(req.user.id, 'ID_' + action, 'user', u.id, result.previous, { identity_status: result.status });
  res.json({ message: 'Verification ' + action, status: result.status });
});

/* ---------------- LISTINGS ---------------- */
router.get('/listings', requireAdmin(), (req, res) => {
  const { status } = req.query;
  let sql = `SELECT l.*, p.business_name, u.full_name AS provider_name FROM listings l JOIN providers p ON p.id = l.provider_id JOIN users u ON u.id = p.user_id WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND l.status = ?'; params.push(status); }
  sql += ' ORDER BY l.created_at DESC LIMIT 200';
  res.json({ listings: db.prepare(sql).all(...params) });
});
router.post('/listings/:id/status', requireAdmin(), (req, res) => {
  const { status } = req.body || {};
  if (!['PENDING', 'APPROVED', 'REJECTED', 'UNPUBLISHED'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const row = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Listing not found' });
  db.prepare('UPDATE listings SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, row.id);
  audit(req.user.id, 'LISTING_' + status, 'listing', row.id, { status: row.status }, { status });
  res.json({ message: 'Listing ' + status });
});

/* ---------------- BOOKINGS, FINANCE & REFUNDS ---------------- */
router.get('/bookings', requireAdmin(), (req, res) => {
  const rows = db.prepare(`SELECT b.*, u.full_name AS customer_name, u.email AS customer_email, p.business_name FROM bookings b JOIN users u ON u.id = b.customer_id LEFT JOIN providers p ON p.id = b.provider_id ORDER BY b.created_at DESC LIMIT 300`).all();
  res.json({ bookings: rows });
});
router.get('/transactions', requireAdmin('FINANCE_ADMIN'), (req, res) => {
  res.json({ transactions: db.prepare('SELECT * FROM financial_transactions ORDER BY created_at DESC LIMIT 300').all() });
});
router.get('/refunds', requireAdmin('FINANCE_ADMIN'), (req, res) => {
  const rows = db.prepare(`SELECT r.*, ft.txn_ref, ft.amount AS transaction_amount, u.email, u.full_name FROM refunds r JOIN financial_transactions ft ON ft.id = r.transaction_id JOIN users u ON u.id = ft.customer_id ORDER BY r.created_at DESC LIMIT 200`).all();
  res.json({ refunds: rows });
});
router.post('/refunds/:id/status', requireAdmin('FINANCE_ADMIN'), async (req, res) => {
  const { status } = req.body || {};
  if (!['APPROVED', 'REJECTED', 'PROCESSED'].includes(status)) return res.status(400).json({ error: 'Invalid refund status' });
  const r = db.prepare('SELECT * FROM refunds WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Refund not found' });
  if (status === 'PROCESSED') {
    const result = await payments.processRefund(r.id, req.user.id);
    if (result.error) return res.status(400).json(result);
    audit(req.user.id, 'REFUND_PROCESSED', 'refund', r.id, { status: r.status }, { status });
    return res.json({ message: 'Refund processed', reference: result.reference });
  }
  db.prepare('UPDATE refunds SET status = ? WHERE id = ?').run(status, r.id);
  if (status === 'APPROVED') db.prepare('UPDATE financial_transactions SET refund_status = ? WHERE id = ?').run('APPROVED', r.transaction_id);
  if (status === 'REJECTED') db.prepare('UPDATE financial_transactions SET refund_status = ? WHERE id = ?').run('REJECTED', r.transaction_id);
  audit(req.user.id, 'REFUND_' + status, 'refund', r.id, { status: r.status }, { status });
  res.json({ message: 'Refund ' + status });
});

/* ---------------- SUBSCRIPTIONS ---------------- */
router.get('/manual-payment-submissions', requireAdmin(), (req, res) => {
  const submissions = db.prepare(`SELECT m.*, u.full_name, u.email, u.phone, s.status AS subscription_status FROM manual_payment_submissions m JOIN users u ON u.id = m.user_id JOIN subscriptions s ON s.id = m.subscription_id ORDER BY CASE WHEN m.status = 'PAID_REPORTED' THEN 0 ELSE 1 END, m.created_at DESC LIMIT 200`).all();
  res.json({ submissions });
});
router.post('/manual-payment-submissions/:id/status', requireAdmin('FINANCE_ADMIN'), (req, res) => {
  const { status, note } = req.body || {};
  if (!['APPROVED', 'REJECTED'].includes(status)) return res.status(400).json({ error: 'status must be APPROVED or REJECTED' });
  const row = db.prepare(`SELECT m.*, s.status AS subscription_status, s.expires_at, p.billing_period_days FROM manual_payment_submissions m JOIN subscriptions s ON s.id = m.subscription_id JOIN subscription_plans p ON p.id = s.plan_id WHERE m.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Manual payment submission not found' });
  if (row.status === 'APPROVED' || row.status === 'REJECTED') return res.status(400).json({ error: `Submission is already ${row.status}` });
  const now = new Date();
  if (status === 'APPROVED') {
    const starts = now.toISOString();
    const expires = new Date(now.getTime() + row.billing_period_days * 864e5).toISOString();
    db.prepare(`UPDATE manual_payment_submissions SET status = 'APPROVED', reviewed_at = datetime('now'), reviewed_by = ?, review_note = ? WHERE id = ?`).run(req.user.id, note || null, row.id);
    db.prepare(`UPDATE subscriptions SET status = 'ACTIVE', payment_status = 'PAID', starts_at = ?, expires_at = ?, updated_at = datetime('now') WHERE id = ?`).run(starts, expires, row.subscription_id);
    if (row.audience === 'provider') {
      const provider = db.prepare('SELECT * FROM providers WHERE user_id = ?').get(row.user_id);
      if (provider) {
        const graceDays = parseInt(getSetting('provider_subscription_grace_days') || '7', 10);
        const graceUntil = new Date(new Date(expires).getTime() + graceDays * 864e5).toISOString();
        db.prepare(`UPDATE providers SET subscription_status = 'ACTIVE', subscription_start = ?, subscription_expiry = ?, subscription_grace_until = ? WHERE id = ?`).run(starts, expires, graceUntil, provider.id);
      }
    }
    notify(row.user_id, 'subscription', 'Subscription payment verified', 'Your manual subscription payment was verified and your subscription is now active.');
  } else {
    db.prepare(`UPDATE manual_payment_submissions SET status = 'REJECTED', reviewed_at = datetime('now'), reviewed_by = ?, review_note = ? WHERE id = ?`).run(req.user.id, note || null, row.id);
    db.prepare(`UPDATE subscriptions SET status = 'REJECTED', payment_status = 'FAILED', updated_at = datetime('now') WHERE id = ?`).run(row.subscription_id);
    notify(row.user_id, 'subscription', 'Subscription payment needs attention', note || 'The owner could not verify this payment. Please contact support.');
  }
  audit(req.user.id, 'MANUAL_SUBSCRIPTION_PAYMENT_' + status, 'manual_payment_submission', row.id, { status: row.status }, { status, note: note || null });
  res.json({ message: 'Manual payment ' + status.toLowerCase() });
});
router.get('/subscriptions', requireAdmin(), (req, res) => {
  const rows = db.prepare(`SELECT s.*, u.full_name, p.name AS plan_name, p.audience FROM subscriptions s JOIN users u ON u.id = s.user_id JOIN subscription_plans p ON p.id = s.plan_id ORDER BY s.created_at DESC LIMIT 200`).all();
  res.json({ subscriptions: rows });
});
router.get('/subscription-plans', requireAdmin(), (req, res) => res.json({ plans: db.prepare('SELECT * FROM subscription_plans ORDER BY id').all() }));
router.put('/subscription-plans/:id', requireAdmin(), (req, res) => {
  const { price, billing_period_days, trial_days, active, name } = req.body || {};
  const plan = db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(req.params.id);
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  db.prepare(`UPDATE subscription_plans SET price = COALESCE(?, price), billing_period_days = COALESCE(?, billing_period_days), trial_days = COALESCE(?, trial_days), active = COALESCE(?, active), name = COALESCE(?, name) WHERE id = ?`).run(price != null ? parseFloat(price) : null, billing_period_days != null ? parseInt(billing_period_days, 10) : null, trial_days != null ? parseInt(trial_days, 10) : null, active != null ? (active ? 1 : 0) : null, name || null, plan.id);
  audit(req.user.id, 'PLAN_UPDATED', 'subscription_plan', plan.id, { price: plan.price }, { price: price != null ? parseFloat(price) : plan.price });
  res.json({ plan: db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(plan.id) });
});

/* ---------------- COMMISSIONS ---------------- */
router.get('/commissions', requireAdmin(), (req, res) => {
  res.json({ commissions: db.prepare('SELECT * FROM commission_rules ORDER BY id').all() });
});
router.put('/commissions/:category', requireAdmin(), (req, res) => {
  const { percent, fixed_fee, active } = req.body || {};
  const r = db.prepare('SELECT * FROM commission_rules WHERE category = ?').get(req.params.category);
  if (!r) return res.status(404).json({ error: 'Commission rule not found' });
  db.prepare(`UPDATE commission_rules SET percent = COALESCE(?, percent), fixed_fee = COALESCE(?, fixed_fee), active = COALESCE(?, active) WHERE category = ?`).run(percent != null ? parseFloat(percent) : null, fixed_fee != null ? parseFloat(fixed_fee) : null, active != null ? (active ? 1 : 0) : null, r.category);
  audit(req.user.id, 'COMMISSION_CHANGED', 'commission_rule', r.category, { percent: r.percent, fixed_fee: r.fixed_fee }, { percent: percent != null ? parseFloat(percent) : r.percent, fixed_fee: fixed_fee != null ? parseFloat(fixed_fee) : r.fixed_fee });
  res.json({ commission: db.prepare('SELECT * FROM commission_rules WHERE category = ?').get(r.category) });
});

/* ---------------- CONTROL CENTER ---------------- */
router.get('/controls', requireAdmin(), (req, res) => {
  const keys = ['registrations', 'bookings', 'payments', 'provider_registrations', 'transportation', 'delivery', 'hotels', 'short_stay', 'property', 'maintenance'];
  const controls = {}; for (const k of keys) controls[k] = getControl(k);
  res.json({ controls });
});
router.post('/controls', requireAdmin(), (req, res) => {
  const { key, value } = req.body || {};
  const allowed = ['registrations', 'bookings', 'payments', 'provider_registrations', 'transportation', 'delivery', 'hotels', 'short_stay', 'property', 'maintenance'];
  if (!allowed.includes(key)) return res.status(400).json({ error: 'Invalid control key' });
  setControl(key, value); audit(req.user.id, 'CONTROL_' + key, 'control', key, null, { value }); res.json({ key, value: getControl(key) });
});

router.put('/settings', requireAdmin(), (req, res) => {
  const updates = req.body || {};
  for (const [key, value] of Object.entries(updates)) setSetting(key, value, req.user.id);
  audit(req.user.id, 'SETTINGS_UPDATED', 'settings', null, null, updates); res.json({ settings: updates });
});
router.get('/settings', requireAdmin(), (req, res) => {
  const rows = db.prepare('SELECT key, value, updated_at FROM platform_settings ORDER BY key').all();
  const settings = {}; for (const r of rows) settings[r.key] = r.value; res.json({ settings });
});

/* ---------------- AUDIT & REPORTING ---------------- */
router.get('/audit', requireAdmin(), (req, res) => {
  const { action, limit = 200 } = req.query; let sql = 'SELECT * FROM audit_logs'; const params = [];
  if (action) { sql += ' WHERE action = ?'; params.push(action); }
  sql += ' ORDER BY created_at DESC LIMIT ?'; params.push(Math.min(parseInt(limit, 10) || 200, 500));
  res.json({ logs: db.prepare(sql).all(...params) });
});
router.get('/reports', requireAdmin(), (req, res) => {
  const revenue = db.prepare(`SELECT category, COUNT(*) bookings, COALESCE(SUM(amount),0) gross, COALESCE(SUM(platform_fee),0) platform_revenue FROM financial_transactions WHERE status = 'SUCCESS' GROUP BY category`).all();
  const bookings = db.prepare(`SELECT category, status, COUNT(*) count FROM bookings GROUP BY category, status`).all();
  res.json({ revenue, bookings });
});

module.exports = router;
