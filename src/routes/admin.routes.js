'use strict';
/** Owner Dashboard API — strict RBAC, full audit trail, session management, 2FA. */
const express = require('express');
const { db, getSetting, setSetting, getControl, setControl } = require('../db');
const { hashPassword, verifyPassword, createRateLimiter } = require('../security');
const { requireAdmin, audit, createAdminSession, revokeAdminSession, publicAdmin, otplib, ADMIN_ROLES } = require('../auth');
const { notify, sendCampaign } = require('../services/notifications');
const verification = require('../services/verification');
const subscriptions = require('../services/subscriptions');
const payments = require('../services/payments');
const router = express.Router();

const loginLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 10, keyFn: (req) => req.ip });

/* ---------------- AUTH (public login; rest admin-only) ---------------- */
const authRouter = express.Router();

// POST /api/admin/auth/login — owner/staff login with optional 2FA
authRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password, two_factor_code } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase().trim());
  if (!u || !verifyPassword(password, u.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
  const a = db.prepare('SELECT * FROM admin_users WHERE user_id = ?').get(u.id);
  if (!a || a.status !== 'ACTIVE') return res.status(403).json({ error: 'Admin access required' });
  if (u.status !== 'ACTIVE') return res.status(403).json({ error: 'Account is not active' });
  if (u.two_factor_enabled) {
    if (!two_factor_code) return res.json({ two_factor_required: true });
    const valid = await otplib.verify({ token: String(two_factor_code), secret: u.two_factor_secret });
    if (!valid) return res.status(401).json({ error: 'Invalid 2FA code' });
  }
  db.prepare('UPDATE users SET last_login_at = datetime(\'now\') WHERE id = ?').run(u.id);
  const token = createAdminSession(u, req.ip);
  audit(u.id, 'ADMIN_LOGIN', 'admin_user', u.id, null, { role: a.role }, req.ip);
  res.json({ token, admin: publicAdmin(a, u) });
});

// GET /api/admin/auth/me
authRouter.get('/me', requireAdmin(), (req, res) => {
  res.json({ admin: publicAdmin(req.admin, req.user) });
});

// POST /api/admin/auth/logout
authRouter.post('/logout', requireAdmin(), (req, res) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (token) revokeAdminSession(req.user.id, token);
  res.json({ ok: true });
});

// POST /api/admin/auth/2fa/setup — generate TOTP secret for the current admin
authRouter.post('/2fa/setup', requireAdmin(), async (req, res) => {
  const secret = otplib.generateSecret();
  db.prepare('UPDATE users SET two_factor_secret = ? WHERE id = ?').run(secret, req.user.id);
  const otpauth_url = otplib.generateURI({ secret, label: req.user.email, issuer: 'PANDOX ODA CONNECT' });
  res.json({ secret, otpauth_url });
});

router.use('/auth', authRouter);

/* ---------------- DASHBOARD ---------------- */
router.get('/dashboard', requireAdmin(), (req, res) => {
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const stats = {
    total_users: one('SELECT COUNT(*) c FROM users WHERE role = ?', 'customer').c,
    active_users: one('SELECT COUNT(*) c FROM users WHERE role = ? AND status = ?', 'customer', 'ACTIVE').c,
    pending_users: one('SELECT COUNT(*) c FROM users WHERE identity_status IN (?, ?)', 'PENDING', 'UNDER_REVIEW').c,
    total_providers: one('SELECT COUNT(*) c FROM providers').c,
    pending_providers: one('SELECT COUNT(*) c FROM providers WHERE status = ?', 'PENDING_VERIFICATION').c,
    drivers: one('SELECT COUNT(*) c FROM providers WHERE provider_type = ?', 'driver').c,
    delivery_providers: one('SELECT COUNT(*) c FROM providers WHERE provider_type = ?', 'delivery').c,
    hotels: one('SELECT COUNT(*) c FROM providers WHERE provider_type = ?', 'hotel').c,
    short_stay_providers: one('SELECT COUNT(*) c FROM providers WHERE provider_type = ?', 'short_stay').c,
    property_listings: one('SELECT COUNT(*) c FROM listings WHERE category IN (?, ?)', 'apartment', 'property').c,
    todays_bookings: one('SELECT COUNT(*) c FROM bookings WHERE date(created_at) = ?', today).c,
    pending_bookings: one('SELECT COUNT(*) c FROM bookings WHERE status = ?', 'PENDING').c,
    completed_bookings: one('SELECT COUNT(*) c FROM bookings WHERE status = ?', 'COMPLETED').c,
    todays_revenue: one('SELECT COALESCE(SUM(amount),0) s FROM financial_transactions WHERE status = ? AND date(created_at) = ?', 'SUCCESSFUL', today).s,
    monthly_revenue: one('SELECT COALESCE(SUM(amount),0) s FROM financial_transactions WHERE status = ? AND substr(created_at,1,7) = ?', 'SUCCESSFUL', month).s,
    subscription_revenue: one('SELECT COALESCE(SUM(amount),0) s FROM financial_transactions WHERE status = ? AND type = ?', 'SUCCESSFUL', 'subscription').s,
    platform_commission: one('SELECT COALESCE(SUM(platform_fee),0) s FROM financial_transactions WHERE status = ?', 'SUCCESSFUL').s,
    refunds: one('SELECT COUNT(*) c FROM refunds WHERE status = ?', 'REQUESTED').c,
    pending_approvals: one('SELECT COUNT(*) c FROM listings WHERE status = ?', 'PENDING').c,
    open_disputes: one('SELECT COUNT(*) c FROM disputes WHERE status = ?', 'OPEN').c
  };
  res.json({ stats });
});

/* ---------------- USERS ---------------- */
router.get('/users', requireAdmin(), (req, res) => {
  const { role, status, q } = req.query;
  let sql = 'SELECT id, email, phone, full_name, role, status, identity_status, two_factor_enabled, created_at, last_login_at FROM users WHERE 1=1';
  const p = [];
  if (role) { sql += ' AND role = ?'; p.push(role); }
  if (status) { sql += ' AND status = ?'; p.push(status); }
  if (q) { sql += ' AND (full_name LIKE ? OR email LIKE ? OR phone LIKE ?)'; p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  sql += ' ORDER BY created_at DESC LIMIT 200';
  res.json({ users: db.prepare(sql).all(...p) });
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

// POST /api/admin/providers/:id/verify — approve/reject provider application
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

// POST /api/admin/providers/:id/status — suspend/reactivate
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
  const rows = db.prepare(`SELECT u.id, u.full_name, u.email, u.phone, u.identity_type, u.identity_status, u.created_at
    FROM users u WHERE u.identity_status != 'NONE' ORDER BY u.created_at DESC LIMIT 200`).all();
  res.json({ verifications: rows });
});

// POST /api/admin/verifications/:id/review — review a user's identity (by user id)
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
  let sql = `SELECT l.*, p.business_name, u.full_name AS provider_name FROM listings l
    JOIN providers p ON p.id = l.provider_id JOIN users u ON u.id = p.user_id WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND l.status = ?'; params.push(status); }
  sql += ' ORDER BY l.created_at DESC LIMIT 200';
  res.json({ listings: db.prepare(sql).all(...params) });
});

// POST /api/admin/listings/:id/status
router.post('/listings/:id/status', requireAdmin(), (req, res) => {
  const { status } = req.body || {};
  if (!['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const l = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!l) return res.status(404).json({ error: 'Listing not found' });
  db.prepare('UPDATE listings SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, l.id);
  const p = db.prepare('SELECT user_id FROM providers WHERE id = ?').get(l.provider_id);
  audit(req.user.id, 'LISTING_' + status, 'listing', l.id, { status: l.status }, { status });
  if (p) notify(p.user_id, 'listing', 'Listing ' + status.toLowerCase(), 'Your listing "' + l.title + '" is now ' + status + '.');
  res.json({ message: 'Listing ' + status });
});

/* ---------------- BOOKINGS ---------------- */
router.get('/bookings', requireAdmin(), (req, res) => {
  const { status } = req.query;
  let sql = `SELECT b.*, cu.full_name AS customer_name, p.business_name, pu.full_name AS provider_name
    FROM bookings b JOIN users cu ON cu.id = b.customer_id
    LEFT JOIN providers p ON p.id = b.provider_id LEFT JOIN users pu ON pu.id = p.user_id WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND b.status = ?'; params.push(status); }
  sql += ' ORDER BY b.created_at DESC LIMIT 200';
  res.json({ bookings: db.prepare(sql).all(...params) });
});

// POST /api/admin/bookings/:id/cancel
router.post('/bookings/:id/cancel', requireAdmin(), (req, res) => {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  if (['COMPLETED', 'CANCELLED'].includes(b.status)) return res.status(400).json({ error: `Booking is already ${b.status}` });
  const { reason } = req.body || {};
  db.prepare(`UPDATE bookings SET status = 'CANCELLED', cancellation_reason = ?, cancelled_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(reason || 'Cancelled by platform', b.id);
  audit(req.user.id, 'BOOKING_CANCELLED', 'booking', b.id, { status: b.status }, { status: 'CANCELLED' });
  notify(b.customer_id, 'booking', 'Booking cancelled', `Booking ${b.booking_ref} was cancelled.`);
  res.json({ message: 'Booking cancelled' });
});

/* ---------------- DISPUTES ---------------- */
router.get('/disputes', requireAdmin(), (req, res) => {
  const { status } = req.query;
  let sql = `SELECT d.*, u.full_name AS raised_by_name FROM disputes d JOIN users u ON u.id = d.raised_by WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND d.status = ?'; params.push(status); }
  sql += ' ORDER BY d.created_at DESC LIMIT 200';
  res.json({ disputes: db.prepare(sql).all(...params) });
});

// POST /api/admin/disputes/:id/status
router.post('/disputes/:id/status', requireAdmin(), (req, res) => {
  const { status, resolution } = req.body || {};
  const allowed = ['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const d = db.prepare('SELECT * FROM disputes WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Dispute not found' });
  db.prepare(`UPDATE disputes SET status = ?, resolution = COALESCE(?, resolution), updated_at = datetime('now') WHERE id = ?`).run(status, resolution || null, d.id);
  audit(req.user.id, 'DISPUTE_' + status, 'dispute', d.id, { status: d.status }, { status, resolution: resolution || null });
  notify(d.raised_by, 'dispute', 'Dispute updated', `Your dispute ${d.dispute_ref} status: ${status}.`);
  res.json({ message: 'Dispute ' + status });
});

/* ---------------- TRANSACTIONS / REFUNDS ---------------- */
router.get('/transactions', requireAdmin(), (req, res) => {
  const { status } = req.query;
  let sql = 'SELECT * FROM financial_transactions WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY created_at DESC LIMIT 200';
  res.json({ transactions: db.prepare(sql).all(...params) });
});

router.get('/refunds', requireAdmin(), (req, res) => {
  const rows = db.prepare(`SELECT r.*, u.full_name AS customer_name FROM refunds r
    JOIN financial_transactions t ON t.id = r.transaction_id
    JOIN users u ON u.id = t.customer_id ORDER BY r.created_at DESC LIMIT 200`).all();
  res.json({ refunds: rows });
});

router.post('/refunds', requireAdmin(), (req, res) => {
  const { transaction_id, amount, reason } = req.body || {};
  const tx = db.prepare('SELECT * FROM financial_transactions WHERE id = ?').get(transaction_id);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  const amt = parseFloat(amount);
  if (!amt || amt <= 0 || amt > tx.amount) return res.status(400).json({ error: 'Invalid refund amount' });
  const refundRef = `RFD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const info = db.prepare('INSERT INTO refunds (refund_ref, transaction_id, amount, reason, status, processed_by) VALUES (?,?,?,?,?,?)')
    .run(refundRef, tx.id, amt, reason || null, 'REQUESTED', req.user.id);
  audit(req.user.id, 'REFUND_REQUESTED', 'transaction', tx.id, { amount: tx.amount }, { refund_amount: amt });
  res.status(201).json({ refund: db.prepare('SELECT * FROM refunds WHERE id = ?').get(info.lastInsertRowid) });
});

router.post('/refunds/:id/status', requireAdmin(), async (req, res) => {
  const { status } = req.body || {};
  if (!['REQUESTED', 'APPROVED', 'PROCESSED', 'REJECTED'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const r = db.prepare('SELECT * FROM refunds WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Refund not found' });
  if (status === 'PROCESSED') {
    const result = await payments.processRefund(r.id, req.user.id);
    if (result.error) return res.status(400).json(result);
    audit(req.user.id, 'REFUND_PROCESSED', 'refund', r.id, { status: r.status }, { status: 'PROCESSED' });
    return res.json({ message: 'Refund processed', reference: result.reference });
  }
  db.prepare('UPDATE refunds SET status = ? WHERE id = ?').run(status, r.id);
  if (status === 'APPROVED') db.prepare('UPDATE financial_transactions SET refund_status = ? WHERE id = ?').run('APPROVED', r.transaction_id);
  if (status === 'REJECTED') db.prepare('UPDATE financial_transactions SET refund_status = ? WHERE id = ?').run('REJECTED', r.transaction_id);
  audit(req.user.id, 'REFUND_' + status, 'refund', r.id, { status: r.status }, { status });
  res.json({ message: 'Refund ' + status });
});

/* ---------------- SUBSCRIPTIONS ---------------- */
router.get('/subscriptions', requireAdmin(), (req, res) => {
  const rows = db.prepare(`SELECT s.*, u.full_name, p.name AS plan_name, p.audience FROM subscriptions s
    JOIN users u ON u.id = s.user_id JOIN subscription_plans p ON p.id = s.plan_id
    ORDER BY s.created_at DESC LIMIT 200`).all();
  res.json({ subscriptions: rows });
});

router.get('/subscription-plans', requireAdmin(), (req, res) => {
  res.json({ plans: db.prepare('SELECT * FROM subscription_plans ORDER BY id').all() });
});

router.put('/subscription-plans/:id', requireAdmin(), (req, res) => {
  const { price, billing_period_days, trial_days, active, name } = req.body || {};
  const plan = db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(req.params.id);
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  db.prepare(`UPDATE subscription_plans SET
    price = COALESCE(?, price), billing_period_days = COALESCE(?, billing_period_days),
    trial_days = COALESCE(?, trial_days), active = COALESCE(?, active), name = COALESCE(?, name) WHERE id = ?`)
    .run(price != null ? parseFloat(price) : null, billing_period_days != null ? parseInt(billing_period_days, 10) : null,
      trial_days != null ? parseInt(trial_days, 10) : null, active != null ? (active ? 1 : 0) : null, name || null, plan.id);
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
  db.prepare(`UPDATE commission_rules SET percent = COALESCE(?, percent), fixed_fee = COALESCE(?, fixed_fee), active = COALESCE(?, active) WHERE category = ?`)
    .run(percent != null ? parseFloat(percent) : null, fixed_fee != null ? parseFloat(fixed_fee) : null, active != null ? (active ? 1 : 0) : null, r.category);
  audit(req.user.id, 'COMMISSION_CHANGED', 'commission_rule', r.category, { percent: r.percent, fixed_fee: r.fixed_fee }, { percent: percent != null ? parseFloat(percent) : r.percent, fixed_fee: fixed_fee != null ? parseFloat(fixed_fee) : r.fixed_fee });
  res.json({ commission: db.prepare('SELECT * FROM commission_rules WHERE category = ?').get(r.category) });
});

/* ---------------- CONTROL CENTER ---------------- */
router.get('/controls', requireAdmin(), (req, res) => {
  const keys = ['registrations', 'bookings', 'payments', 'provider_registrations', 'transportation', 'delivery', 'hotels', 'short_stay', 'property', 'maintenance'];
  const controls = {};
  for (const k of keys) controls[k] = getControl(k);
  res.json({ controls });
});

router.post('/controls', requireAdmin(), (req, res) => {
  const { key, value } = req.body || {};
  const allowed = ['registrations', 'bookings', 'payments', 'provider_registrations', 'transportation', 'delivery', 'hotels', 'short_stay', 'property', 'maintenance'];
  if (!allowed.includes(key)) return res.status(400).json({ error: 'Invalid control key' });
  const prev = getControl(key);
  setControl(key, value === 'on' ? 'on' : 'off');
  audit(req.user.id, 'CONTROL_CHANGED', 'platform_control', key, { value: prev }, { value: value === 'on' ? 'on' : 'off' });
  res.json({ message: 'Control updated', key, value: value === 'on' ? 'on' : 'off' });
});

/* ---------------- SETTINGS ---------------- */
router.get('/settings', requireAdmin(), (req, res) => {
  const rows = db.prepare('SELECT key, value FROM platform_settings').all();
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json({ settings });
});

router.put('/settings', requireAdmin(), (req, res) => {
  const body = req.body || {};
  const allowed = ['platform_name', 'platform_tagline', 'support_email', 'support_phone', 'marketplace_disclaimer',
    'listing_approval_required', 'cancellation_window_minutes', 'cancellation_fee_percent', 'ride_estimation_enabled',
    'maps_enabled', 'email_enabled', 'sms_enabled', 'push_enabled', 'payments_enabled',
    'customer_subscription_price', 'customer_subscription_period_days', 'customer_subscription_trial_days', 'customer_subscription_active',
    'provider_subscription_price', 'provider_subscription_period_days', 'provider_subscription_grace_days', 'provider_subscription_active'];
  const keys = Object.keys(body).filter(k => allowed.includes(k));
  if (!keys.length) return res.status(400).json({ error: 'No valid settings provided' });
  for (const k of keys) {
    const prev = getSetting(k);
    setSetting(k, body[k], req.user.id);
    audit(req.user.id, 'SETTING_CHANGED', 'platform_setting', k, { value: prev }, { value: body[k] });
  }
  res.json({ message: 'Settings updated', updated: keys });
});

/* ---------------- POLICIES ---------------- */
router.get('/policies', requireAdmin(), (req, res) => {
  res.json({ policies: db.prepare('SELECT * FROM policies ORDER BY id').all() });
});

router.put('/policies/:id', requireAdmin(), (req, res) => {
  const { content } = req.body || {};
  const p = db.prepare('SELECT * FROM policies WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Policy not found' });
  if (content === undefined) return res.status(400).json({ error: 'content is required' });
  db.prepare(`UPDATE policies SET content = ?, version = version + 1, updated_at = datetime('now') WHERE id = ?`).run(content, p.id);
  audit(req.user.id, 'POLICY_UPDATED', 'policy', p.id, { version: p.version }, { version: p.version + 1 });
  res.json({ policy: db.prepare('SELECT * FROM policies WHERE id = ?').get(p.id) });
});

/* ---------------- CAMPAIGNS ---------------- */
router.get('/campaigns', requireAdmin(), (req, res) => {
  res.json({ campaigns: db.prepare('SELECT * FROM notification_campaigns ORDER BY created_at DESC LIMIT 100').all() });
});

router.post('/campaigns', requireAdmin(), (req, res) => {
  const { title, body, audience, target_user_ids } = req.body || {};
  if (!title || !body || !audience) return res.status(400).json({ error: 'title, body and audience are required' });
  const info = db.prepare('INSERT INTO notification_campaigns (title, body, audience, target_user_ids, status) VALUES (?,?,?,?,?)')
    .run(title, body, audience, target_user_ids || null, 'DRAFT');
  audit(req.user.id, 'CAMPAIGN_CREATED', 'campaign', info.lastInsertRowid, null, { title, audience });
  res.status(201).json({ campaign: db.prepare('SELECT * FROM notification_campaigns WHERE id = ?').get(info.lastInsertRowid) });
});

router.post('/campaigns/:id/send', requireAdmin(), (req, res) => {
  const result = sendCampaign(req.params.id);
  if (result.error) return res.status(400).json(result);
  audit(req.user.id, 'CAMPAIGN_SENT', 'campaign', req.params.id, null, { sent: result.sent });
  res.json({ sent: result.sent });
});

/* ---------------- STAFF ---------------- */
router.get('/staff', requireAdmin(), (req, res) => {
  const rows = db.prepare(`SELECT a.id, a.role, a.status, u.full_name, u.email, u.two_factor_enabled, u.last_login_at
    FROM admin_users a JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC`).all();
  res.json({ staff: rows });
});

router.post('/staff', requireAdmin('SUPER_ADMIN'), (req, res) => {
  const { full_name, email, password, role } = req.body || {};
  if (!full_name || !email || !password) return res.status(400).json({ error: 'full_name, email and password are required' });
  if (!ADMIN_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (password.length < 10) return res.status(400).json({ error: 'Password must be at least 10 characters' });
  const normEmail = String(email).toLowerCase().trim();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normEmail);
  if (existing) return res.status(409).json({ error: 'A user with this email already exists' });
  const info = db.prepare('INSERT INTO users (email, full_name, password_hash, role, status) VALUES (?,?,?,?,?)')
    .run(normEmail, full_name, hashPassword(password), 'admin', 'ACTIVE');
  db.prepare('INSERT INTO admin_users (user_id, role) VALUES (?,?)').run(info.lastInsertRowid, role);
  audit(req.user.id, 'STAFF_CREATED', 'admin_user', info.lastInsertRowid, null, { role });
  res.status(201).json({ message: 'Admin created', staff: db.prepare('SELECT a.id, a.role, u.full_name, u.email FROM admin_users a JOIN users u ON u.id = a.user_id WHERE a.user_id = ?').get(info.lastInsertRowid) });
});

/* ---------------- AUDIT LOG ---------------- */
router.get('/audit-logs', requireAdmin(), (req, res) => {
  const rows = db.prepare(`SELECT l.*, u.email AS admin_email FROM audit_logs l JOIN users u ON u.id = l.admin_id ORDER BY l.created_at DESC LIMIT 200`).all();
  res.json({ logs: rows });
});

/* ---------------- SESSIONS ---------------- */
router.get('/sessions', requireAdmin(), (req, res) => {
  const rows = db.prepare(`SELECT s.id, s.ip, s.created_at, s.expires_at, s.revoked_at, u.email FROM admin_sessions s
    JOIN users u ON u.id = s.user_id ORDER BY s.created_at DESC LIMIT 200`).all();
  res.json({ sessions: rows });
});

router.post('/sessions/revoke', requireAdmin(), (req, res) => {
  const { session_id } = req.body || {};
  if (!session_id) return res.status(400).json({ error: 'session_id is required' });
  const s = db.prepare('SELECT * FROM admin_sessions WHERE id = ?').get(session_id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  db.prepare(`UPDATE admin_sessions SET revoked_at = datetime('now') WHERE id = ?`).run(s.id);
  audit(req.user.id, 'SESSION_REVOKED', 'admin_session', s.id, null, { user_id: s.user_id });
  res.json({ message: 'Session revoked' });
});

/* ---------------- REPORTS ---------------- */
router.get('/reports', requireAdmin(), (req, res) => {
  const period = req.query.period || 'month';
  const fmt = period === 'day' ? '%Y-%m-%d' : period === 'year' ? '%Y' : '%Y-%m';
  const revenue = db.prepare(`SELECT strftime('${fmt}', created_at) AS period, COUNT(*) AS tx_count,
    COALESCE(SUM(amount),0) AS revenue, COALESCE(SUM(platform_fee),0) AS commission, COALESCE(SUM(provider_amount),0) AS provider_earnings
    FROM financial_transactions WHERE status = 'SUCCESSFUL' GROUP BY period ORDER BY period DESC LIMIT 90`).all();
  const bookings = db.prepare(`SELECT strftime('${fmt}', created_at) AS period, COUNT(*) AS count FROM bookings GROUP BY period ORDER BY period DESC LIMIT 90`).all();
  const users = db.prepare(`SELECT strftime('${fmt}', created_at) AS period, COUNT(*) AS count FROM users GROUP BY period ORDER BY period DESC LIMIT 90`).all();
  const providers = db.prepare(`SELECT strftime('${fmt}', created_at) AS period, COUNT(*) AS count FROM providers GROUP BY period ORDER BY period DESC LIMIT 90`).all();
  const refunds = db.prepare(`SELECT strftime('${fmt}', created_at) AS period, COALESCE(SUM(amount),0) AS amount FROM refunds GROUP BY period ORDER BY period DESC LIMIT 90`).all();
  const service_performance = db.prepare(`SELECT category, COUNT(*) AS bookings,
    SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed, AVG(rating) AS avg_rating
    FROM bookings GROUP BY category ORDER BY bookings DESC`).all();
  res.json({ revenue, bookings, users, providers, refunds, service_performance });
});

/* ---------------- MAINTENANCE ---------------- */
router.post('/maintenance/expiry-checks', requireAdmin(), (req, res) => {
  subscriptions.runExpiryChecks();
  audit(req.user.id, 'EXPIRY_CHECKS_RUN', 'maintenance', null, null, null);
  res.json({ ok: true });
});

module.exports = router;
