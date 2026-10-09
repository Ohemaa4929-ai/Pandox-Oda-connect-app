'use strict';
/** Subscription service: customer + provider plans. Prices come from DB settings/plans — never hardcoded. */
const { db } = require('../db');
const ledger = require('./ledger');
const payments = require('./payments');
const { notify } = require('./notifications');

function getSetting(key) {
  const row = db.prepare('SELECT value FROM platform_settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

/** Customer subscription plan is owner-configurable via platform_settings. */
function customerPlan() {
  return {
    name: 'Customer Subscription',
    audience: 'customer',
    price: parseFloat(getSetting('customer_subscription_price') || '0'),
    billing_period_days: parseInt(getSetting('customer_subscription_period_days') || '30', 10),
    trial_days: parseInt(getSetting('customer_subscription_trial_days') || '0', 10),
    active: getSetting('customer_subscription_active') === '1'
  };
}

/** Provider subscription: configurable 3-month plan. */
function providerPlan() {
  return {
    name: 'Provider Subscription (3 months)',
    audience: 'provider',
    price: parseFloat(getSetting('provider_subscription_price') || '0'),
    billing_period_days: parseInt(getSetting('provider_subscription_period_days') || '90', 10),
    grace_days: parseInt(getSetting('provider_subscription_grace_days') || '7', 10),
    active: getSetting('provider_subscription_active') === '1'
  };
}

function currentSubscription(userId) {
  return db.prepare(`SELECT s.*, p.name AS plan_name, p.price AS plan_price FROM subscriptions s
    JOIN subscription_plans p ON p.id = s.plan_id
    WHERE s.user_id = ? ORDER BY s.id DESC LIMIT 1`).get(userId);
}

/** Subscribe a user. Returns payment initialization when a price is set; otherwise activates directly (free plan). */
async function subscribe(userId, audience, email) {
  const plan = audience === 'provider' ? providerPlan() : customerPlan();
  if (!plan.active) return { error: 'Subscriptions are not currently offered on the platform.' };
  const now = new Date();
  const starts = now.toISOString();
  const expires = new Date(now.getTime() + plan.billing_period_days * 864e5).toISOString();
  const info = db.prepare(`INSERT INTO subscriptions (user_id, plan_id, status, starts_at, expires_at, payment_status)
    VALUES (?, (SELECT id FROM subscription_plans WHERE audience = ? LIMIT 1), 'ACTIVE', ?, ?, 'PENDING')`)
    .run(userId, audience, starts, expires);
  const subId = info.lastInsertRowid;

  if (plan.price > 0) {
    const init = await payments.initializePayment({
      customerId: userId, subscriptionId: subId, type: 'subscription', amount: plan.price,
      description: `${plan.name} — ${plan.billing_period_days} days`, email
    });
    if (init.error) {
      db.prepare(`UPDATE subscriptions SET status = 'FAILED', payment_status = 'FAILED' WHERE id = ?`).run(subId);
      return init;
    }
    return { subscription_id: subId, payment: init };
  }
  // Free plan: activate immediately (no fake payment — price is genuinely 0).
  db.prepare(`UPDATE subscriptions SET payment_status = 'PAID' WHERE id = ?`).run(subId);
  if (audience === 'provider') {
    const provider = db.prepare('SELECT * FROM providers WHERE user_id = ?').get(userId);
    if (provider) {
      const graceDays = plan.grace_days;
      db.prepare(`UPDATE providers SET subscription_status = 'ACTIVE', subscription_start = ?, subscription_expiry = ?, subscription_grace_until = ? WHERE id = ?`)
        .run(starts, expires, new Date(new Date(expires).getTime() + graceDays * 864e5).toISOString(), provider.id);
    }
  }
  notify(userId, 'subscription', 'Subscription active', `${plan.name} is now active.`);
  return { subscription_id: subId, activated: true };
}

/** Daily maintenance: expire subscriptions, move to grace, suspend providers. */
function runExpiryChecks() {
  const now = new Date().toISOString();
  const expired = db.prepare(`SELECT * FROM subscriptions WHERE status = 'ACTIVE' AND expires_at < ?`).all(now);
  for (const s of expired) {
    const graceDays = parseInt(getSetting('provider_subscription_grace_days') || '7', 10);
    const graceUntil = new Date(new Date(s.expires_at).getTime() + graceDays * 864e5).toISOString();
    db.prepare(`UPDATE subscriptions SET status = 'GRACE', grace_until = ? WHERE id = ?`).run(graceUntil, s.id);
    notify(s.user_id, 'subscription', 'Subscription expiring', 'Your subscription has expired. Renew to continue using the platform.');
  }
  const graceOver = db.prepare(`SELECT * FROM subscriptions WHERE status = 'GRACE' AND grace_until < ?`).all(now);
  for (const s of graceOver) {
    db.prepare(`UPDATE subscriptions SET status = 'EXPIRED' WHERE id = ?`).run(s.id);
    const provider = db.prepare('SELECT * FROM providers WHERE user_id = ?').get(s.user_id);
    if (provider) {
      db.prepare(`UPDATE providers SET subscription_status = 'SUSPENDED' WHERE id = ?`).run(provider.id);
      notify(s.user_id, 'subscription', 'Subscription suspended', 'Your provider account has been suspended due to an expired subscription.');
    }
  }
}

module.exports = { customerPlan, providerPlan, currentSubscription, subscribe, runExpiryChecks, getSetting };
