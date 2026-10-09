'use strict';
/**
 * Payment service — Paystack (Ghana).
 * Server-side verification only. The frontend NEVER confirms payment.
 * When PAYSTACK_SECRET_KEY is not configured, payment endpoints report NOT CONFIGURED and record nothing.
 */
const { db } = require('../db');
const config = require('../config');
const ledger = require('./ledger');
const { notify } = require('./notifications');

function paymentsEnabled() {
  const row = db.prepare('SELECT value FROM platform_settings WHERE key = ?').get('payments_enabled');
  return row && row.value === '1' && !!config.paystackSecretKey;
}

function notConfigured() {
  return { error: 'NOT CONFIGURED', message: 'Payments are not configured. Set PAYSTACK_SECRET_KEY and enable payments in Platform Settings before accepting payments.' };
}

/** Initialize a payment: create a pending ledger record and return a Paystack checkout URL. */
async function initializePayment({ customerId, providerId, bookingId, subscriptionId, type, amount, description, category, email, metadata }) {
  if (!paymentsEnabled()) return notConfigured();
  const txn = ledger.recordTransaction({ customerId, providerId, bookingId, subscriptionId, type, amount, gateway: 'paystack', description, category });
  try {
    const res = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.paystackSecretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        amount: Math.round(amount * 100), // pesewas
        currency: 'GHS',
        reference: txn.txn_ref,
        metadata: { ...(metadata || {}), txn_id: txn.id, custom_fields: [{ display_name: 'Platform', variable_name: 'platform', value: 'PANDOX ODA CONNECT' }] }
      })
    });
    const data = await res.json();
    if (!data.status) { ledger.markFailed(txn.id, data.message || 'Paystack initialization failed'); return { error: data.message || 'Payment initialization failed' }; }
    return { authorization_url: data.data.authorization_url, access_code: data.data.access_code, reference: txn.txn_ref, txn_id: txn.id };
  } catch (e) {
    ledger.markFailed(txn.id, e.message);
    return { error: 'Payment gateway unreachable' };
  }
}

/** Verify a transaction server-side with Paystack. */
async function verifyTransaction(reference) {
  if (!config.paystackSecretKey) return { error: 'NOT CONFIGURED' };
  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${config.paystackSecretKey}` }
  });
  const data = await res.json();
  if (!data.status) return { error: data.message || 'Verification failed' };
  return data.data;
}

/** Handle a verified successful payment: update ledger, booking, subscription. */
function confirmPayment(reference, gatewayReference) {
  const txn = db.prepare('SELECT * FROM financial_transactions WHERE txn_ref = ?').get(reference);
  if (!txn) return { error: 'Transaction not found' };
  if (txn.status === 'SUCCESSFUL') return { txn }; // idempotent
  ledger.markSuccessful(txn.id, gatewayReference);
  const updated = db.prepare('SELECT * FROM financial_transactions WHERE id = ?').get(txn.id);

  if (txn.booking_id) {
    db.prepare(`UPDATE bookings SET status = 'CONFIRMED', updated_at = datetime('now') WHERE id = ? AND status = 'PENDING'`).run(txn.booking_id);
    notify(txn.customer_id, 'payment', 'Payment successful', `Your payment of GHS ${txn.amount} was received.`);
    notify(txn.customer_id, 'booking', 'Booking confirmed', `Booking confirmed. Reference: ${db.prepare('SELECT booking_ref FROM bookings WHERE id = ?').get(txn.booking_id)?.booking_ref}`);
  }
  if (txn.subscription_id) {
    const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(txn.subscription_id);
    if (sub) {
      db.prepare(`UPDATE subscriptions SET payment_status = 'PAID', status = 'ACTIVE', updated_at = datetime('now') WHERE id = ?`).run(sub.id);
      const plan = db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(sub.plan_id);
      const provider = db.prepare('SELECT * FROM providers WHERE user_id = ?').get(txn.customer_id);
      if (provider) {
        const graceDays = parseInt(db.prepare('SELECT value FROM platform_settings WHERE key = ?').get('provider_subscription_grace_days')?.value || '7', 10);
        db.prepare(`UPDATE providers SET subscription_status = 'ACTIVE', subscription_start = ?, subscription_expiry = ?, subscription_grace_until = ? WHERE id = ?`)
          .run(sub.starts_at, sub.expires_at, new Date(new Date(sub.expires_at).getTime() + graceDays * 864e5).toISOString(), provider.id);
      }
      notify(txn.customer_id, 'subscription', 'Subscription active', `Your ${plan ? plan.name : 'subscription'} is now active.`);
    }
  }
  return { txn: updated };
}

/** Refund via Paystack (server-side). */
async function processRefund(refundId, adminUserId) {
  const refund = db.prepare('SELECT * FROM refunds WHERE id = ?').get(refundId);
  if (!refund) return { error: 'Refund not found' };
  if (refund.status !== 'APPROVED') return { error: 'Refund must be APPROVED before processing' };
  const txn = db.prepare('SELECT * FROM financial_transactions WHERE id = ?').get(refund.transaction_id);
  if (!txn) return { error: 'Transaction not found' };
  if (!config.paystackSecretKey) return { error: 'NOT CONFIGURED', message: 'Paystack is not configured — refund cannot be processed through the gateway.' };
  try {
    const res = await fetch('https://api.paystack.co/refunds', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.paystackSecretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction: txn.gateway_reference || txn.txn_ref, amount: Math.round(refund.amount * 100) })
    });
    const data = await res.json();
    if (!data.status) return { error: data.message || 'Refund failed' };
    db.prepare(`UPDATE refunds SET status = 'PROCESSED', processed_by = ?, gateway_reference = ?, processed_at = datetime('now') WHERE id = ?`).run(adminUserId, data.data.reference, refundId);
    db.prepare(`UPDATE financial_transactions SET refund_status = 'PROCESSED', status = 'REFUNDED', updated_at = datetime('now') WHERE id = ?`).run(txn.id);
    if (txn.booking_id) db.prepare(`UPDATE bookings SET status = 'CANCELLED', cancellation_reason = 'Refunded', cancelled_at = datetime('now') WHERE id = ?`).run(txn.booking_id);
    return { ok: true, reference: data.data.reference };
  } catch (e) {
    return { error: 'Refund gateway unreachable' };
  }
}

module.exports = { paymentsEnabled, notConfigured, initializePayment, verifyTransaction, confirmPayment, processRefund };
