'use strict';
/** User profile, notifications, policy acceptance. */
const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const router = express.Router();

// GET /api/user/profile
router.get('/profile', requireAuth, (req, res) => {
  const u = db.prepare('SELECT id, email, phone, full_name, role, status, email_verified, phone_verified, identity_status, created_at FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: u });
});

// PUT /api/user/profile
router.put('/profile', requireAuth, (req, res) => {
  const { full_name, phone } = req.body || {};
  if (full_name !== undefined) db.prepare('UPDATE users SET full_name = ?, updated_at = datetime(\'now\') WHERE id = ?').run(full_name, req.user.id);
  if (phone !== undefined) db.prepare('UPDATE users SET phone = ?, updated_at = datetime(\'now\') WHERE id = ?').run(phone, req.user.id);
  res.json({ user: db.prepare('SELECT id, email, phone, full_name, role, status FROM users WHERE id = ?').get(req.user.id) });
});

// GET /api/user/notifications
router.get('/notifications', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(req.user.id);
  res.json({ notifications: rows });
});

// POST /api/user/notifications/:id/read
router.post('/notifications/:id/read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// GET /api/user/bookings — booking history
router.get('/bookings', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM bookings WHERE customer_id = ? ORDER BY created_at DESC LIMIT 200').all(req.user.id);
  res.json({ bookings: rows });
});

// GET /api/user/transactions
router.get('/transactions', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM financial_transactions WHERE customer_id = ? ORDER BY created_at DESC LIMIT 200').all(req.user.id);
  res.json({ transactions: rows });
});

// GET /api/policies — active policies
router.get('/policies', (req, res) => {
  const rows = db.prepare('SELECT id, slug, title, version, updated_at FROM policies WHERE active = 1').all();
  res.json({ policies: rows });
});

// GET /api/user/policies/accepted — accepted policies (must precede /policies/:slug)
router.get('/policies/accepted', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT pa.policy_id, pa.version, pa.accepted_at, p.slug, p.title FROM policy_acceptances pa JOIN policies p ON p.id = pa.policy_id WHERE pa.user_id = ?').all(req.user.id);
  res.json({ accepted: rows });
});

// GET /api/policies/:slug
router.get('/policies/:slug', (req, res) => {
  const p = db.prepare('SELECT * FROM policies WHERE slug = ? AND active = 1').get(req.params.slug);
  if (!p) return res.status(404).json({ error: 'Policy not found' });
  res.json({ policy: p });
});

// POST /api/user/policies/accept — accept a policy version
router.post('/policies/accept', requireAuth, (req, res) => {
  const { policy_id } = req.body || {};
  if (!policy_id) return res.status(400).json({ error: 'policy_id is required' });
  const p = db.prepare('SELECT * FROM policies WHERE id = ? AND active = 1').get(policy_id);
  if (!p) return res.status(404).json({ error: 'Policy not found' });
  db.prepare('INSERT OR IGNORE INTO policy_acceptances (user_id, policy_id, version) VALUES (?, ?, ?)').run(req.user.id, p.id, p.version);
  res.json({ ok: true });
});

module.exports = router;
