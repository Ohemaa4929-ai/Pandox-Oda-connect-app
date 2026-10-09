'use strict';
/** Financial ledger: every money movement is a transaction record. Corrections create adjustment records — history is never silently changed. */
const { db } = require('../db');
const crypto = require('crypto');

function ref(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function commissionFor(category, amount) {
  const rule = db.prepare('SELECT * FROM commission_rules WHERE category = ?').get(category);
  if (!rule) return { percent: 0, fixed: 0, fee: 0 };
  const fee = Math.round((amount * rule.percent / 100 + rule.fixed_fee) * 100) / 100;
  return { percent: rule.percent, fixed: rule.fixed_fee, fee };
}

function recordTransaction({ customerId, providerId, bookingId, subscriptionId, type, amount, gateway, gatewayReference, description, category }) {
  const { fee } = commissionFor(category || 'other', amount);
  const providerAmount = Math.round((amount - fee) * 100) / 100;
  const txnRef = ref('TXN');
  const info = db.prepare(`INSERT INTO financial_transactions
    (txn_ref, customer_id, provider_id, booking_id, subscription_id, type, amount, platform_fee, provider_amount, gateway, gateway_reference, status, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`).run(
    txnRef, customerId || null, providerId || null, bookingId || null, subscriptionId || null,
    type, amount, fee, providerAmount, gateway || null, gatewayReference || null, description || null);
  return db.prepare('SELECT * FROM financial_transactions WHERE id = ?').get(info.lastInsertRowid);
}

function markSuccessful(txnId, gatewayReference) {
  const t = db.prepare('SELECT * FROM financial_transactions WHERE id = ?').get(txnId);
  if (!t) return null;
  db.prepare(`UPDATE financial_transactions SET status = 'SUCCESSFUL', gateway_reference = COALESCE(?, gateway_reference), updated_at = datetime('now') WHERE id = ?`).run(gatewayReference || null, txnId);
  return db.prepare('SELECT * FROM financial_transactions WHERE id = ?').get(txnId);
}

function markFailed(txnId, reason) {
  db.prepare(`UPDATE financial_transactions SET status = 'FAILED', description = COALESCE(?, description), updated_at = datetime('now') WHERE id = ?`).run(reason || null, txnId);
}

/** Adjustment: never edit history — append a new adjustment record. */
function adjustment({ txnId, amount, reason, byUserId }) {
  const t = db.prepare('SELECT * FROM financial_transactions WHERE id = ?').get(txnId);
  if (!t) return { error: 'Transaction not found' };
  const adjRef = ref('ADJ');
  const info = db.prepare(`INSERT INTO financial_transactions
    (txn_ref, customer_id, provider_id, booking_id, type, amount, platform_fee, provider_amount, gateway, status, description)
    VALUES (?, ?, ?, ?, 'adjustment', ?, 0, 0, 'system', 'SUCCESSFUL', ?)`).run(
    adjRef, t.customer_id, t.provider_id, t.booking_id, amount, `Adjustment to ${t.txn_ref}: ${reason}`);
  return db.prepare('SELECT * FROM financial_transactions WHERE id = ?').get(info.lastInsertRowid);
}

module.exports = { ref, commissionFor, recordTransaction, markSuccessful, markFailed, adjustment };
