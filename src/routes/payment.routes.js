'use strict';
const express = require('express');
const router = express.Router();
const { db } = require('../db');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const { createPaystackTransaction, verifyPaystackTransaction } = require('../services/payments');
const { activateProviderSubscription, getProviderSubscriptionPlans } = require('../services/subscriptions');

function providerForUser(userId) {
  return db.prepare('SELECT * FROM providers WHERE user_id = ?').get(userId);
}

router.get('/subscription/plans', requireAuth, (req, res) => {
  const provider = providerForUser(req.user.id);
  if (!provider || provider.status !== 'APPROVED') return res.status(403).json({ error: 'Approved provider account required' });
  res.json({ plans: getProviderSubscriptionPlans() });
});

router.post('/subscription/subscribe', requireAuth, async (req, res) => {
  try {
    const provider = providerForUser(req.user.id);
    if (!provider || provider.status !== 'APPROVED') return res.status(403).json({ error: 'Approved provider account required' });
    const planId = req.body?.plan_id || req.body?.planId;
    const plan = getProviderSubscriptionPlans().find((p) => String(p.id) === String(planId));
    if (!plan) return res.status(400).json({ error: 'Invalid subscription plan' });
    if (Number(plan.price) <= 0) {
      const result = activateProviderSubscription(provider.id, plan);
      return res.json({ activated: true, ...result });
    }
    const reference = `prov_${provider.id}_${Date.now()}`;
    const tx = await createPaystackTransaction({ email: req.user.email, amount: Number(plan.price), reference, metadata: { provider_id: provider.id, plan_id: plan.id } });
    res.json({ activated: false, authorization_url: tx.authorization_url, reference });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/subscription/callback', async (req, res) => {
  try {
    const result = await verifyPaystackTransaction(req.query.reference);
    if (result?.status) return res.redirect(`${config.publicBaseUrl || ''}/#/account/subscription?subscribed=1`);
    res.redirect(`${config.publicBaseUrl || ''}/#/account/subscription?subscribed=0`);
  } catch (_) { res.redirect(`${config.publicBaseUrl || ''}/#/account/subscription?subscribed=0`); }
});

module.exports = router;
