'use strict';
/** Payment routes: initialize, verify (server-side), webhook. */
const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const config = require('../config');
const { requireAuth } = require('../auth');
const { notify } = require('../services/notifications');
const payments = require('../services/payments');
const subscriptions = require('../services/subscriptions');
const router = express.Router();

// POST /api/payments/initialize
router.post('/initialize', requireAuth, async (req, res) => {
  const { booking_id, subscription_id, type, amount, description, category } = req.body || {};
  if (!type) return res.status(400).json({ error: 'type is required' });
  if (type === 'booking_payment' && !booking_id) return res.status(400).json({ error: 'booking_id is required' });
  if (type === 'subscription' && !subscription_id) return res.status(400).json({ error: 'subscription_id is required' });
  const init = await awaitInit(req.user, { booking_id, subscription_id, type, amount, description, category });
  if (init.error) return res.status(400).json(init);
  res.json(init);
});

async function awaitInit(user, { booking_id, subscription_id, type, amount, description, category }) {
  return payments.initializePayment({
    customerId: user.id, bookingId: booking_id || null, subscriptionId: subscription_id || null,
    type, amount: parseFloat(amount || 0), description, category, email: user.email
  });
}

// POST /api/payments/verify — server-side verification of a reference
router.post('/verify', requireAuth, async (req, res) => {
  const { reference } = req.body || {};
  if (!reference) return res.status(400).json({ error: 'reference is required' });
  const data = await payments.verifyTransaction(reference);
  if (data.error) return res.status(400).json(data);
  if (data.status === 'success') {
    const result = payments.confirmPayment(reference, data.reference);
    return res.json({ verified: true, status: data.status, txn: result.txn });
  }
  res.json({ verified: false, status: data.status });
});

// POST /api/payments/webhook/paystack — server-to-server webhook
router.post('/webhook/paystack', async (req, res) => {
  const body = JSON.stringify(req.body);
  const signature = req.headers['x-paystack-signature'];
  if (!config.paystackWebhookSecret) return res.status(200).json({ ok: true, note: 'Webhook secret not configured — ignoring' });
  const hash = crypto.createHmac('sha512', config.paystackWebhookSecret).update(body).digest('hex');
  if (hash !== signature) return res.status(401).json({ error: 'Invalid signature' });
  const event = req.body;
  if (event.event === 'charge.success') {
    const reference = event.data.reference;
    payments.confirmPayment(reference, event.data.reference);
  }
  res.json({ ok: true });
});

// POST /api/subscriptions/subscribe
// POST /api/payments/subscriptions/manual-payment — show payment details and create a pending request
router.post('/subscriptions/manual-payment', requireAuth, (req, res) => {
  const { audience } = req.body || {};
  if (!['customer', 'provider'].includes(audience)) return res.status(400).json({ error: 'audience must be customer or provider' });
  if (audience === 'provider') {
    const provider = db.prepare('SELECT status FROM providers WHERE user_id = ?').get(req.user.id);
    if (!provider) return res.status(403).json({ error: 'Provider account required.' });
    if (provider.status !== 'APPROVED') return res.status(403).json({ error: 'Provider approval is required before subscribing.' });
  }
  const result = subscriptions.createManualPayment(req.user.id, audience);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// POST /api/payments/subscriptions/manual-payment/:id/paid — user reports that payment was sent
router.post('/subscriptions/manual-payment/:id/paid', requireAuth, (req, res) => {
  const row = db.prepare(`SELECT m.*, s.status AS subscription_status, p.name AS plan_name
    FROM manual_payment_submissions m JOIN subscriptions s ON s.id = m.subscription_id
    JOIN subscription_plans p ON p.id = s.plan_id WHERE m.id = ? AND m.user_id = ?`).get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Payment request not found.' });
  if (row.status === 'PAID_REPORTED' || row.status === 'APPROVED') return res.json({ reported: true, already_reported: true });
  if (row.status !== 'PENDING') return res.status(400).json({ error: `This payment request is already ${row.status.toLowerCase()}.` });
  db.prepare(`UPDATE manual_payment_submissions SET status = 'PAID_REPORTED', reported_at = datetime('now') WHERE id = ?`).run(row.id);
  db.prepare(`UPDATE subscriptions SET payment_status = 'REPORTED', updated_at = datetime('now') WHERE id = ?`).run(row.subscription_id);
  const admins = db.prepare(`SELECT u.id FROM users u JOIN admin_users a ON a.user_id = u.id WHERE u.status = 'ACTIVE' AND a.status = 'ACTIVE'`).all();
  for (const admin of admins) {
    notify(admin.id, 'manual_payment', 'Manual subscription payment reported', `${req.user.full_name} reported payment for ${row.plan_name}. Review it in Subscriptions.`);
  }
  notify(req.user.id, 'subscription', 'Payment report received', 'Your payment report was sent to the owner. Your subscription remains pending until payment is verified.');
  res.json({ reported: true });
});

router.post('/subscriptions/subscribe', requireAuth, async (req, res) => {
  const { audience } = req.body || {};
  if (!['customer', 'provider'].includes(audience)) return res.status(400).json({ error: 'audience must be customer or provider' });
  if (audience === 'provider') {
    const provider = db.prepare('SELECT status FROM providers WHERE user_id = ?').get(req.user.id);
    if (!provider) return res.status(403).json({ error: 'Provider account required.' });
    if (provider.status !== 'APPROVED') return res.status(403).json({ error: 'Provider approval is required before subscribing.' });
  }
  const result = await subscriptions.subscribe(req.user.id, audience, req.user.email);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// GET /api/subscriptions/me
router.get('/subscriptions/me', requireAuth, (req, res) => {
  const sub = subscriptions.currentSubscription(req.user.id);
  res.json({ subscription: sub, customer_plan: subscriptions.customerPlan(), provider_plan: subscriptions.providerPlan() });
});

module.exports = router;
