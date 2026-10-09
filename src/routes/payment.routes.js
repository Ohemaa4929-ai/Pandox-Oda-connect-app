'use strict';
/** Payment routes: initialize, verify (server-side), webhook. */
const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const config = require('../config');
const { requireAuth } = require('../auth');
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
