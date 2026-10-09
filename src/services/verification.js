'use strict';
/** Identity verification workflow: PENDING → UNDER_REVIEW → APPROVED / REJECTED / REQUEST_RESUBMISSION. */
const { db } = require('../db');
const { notify } = require('./notifications');

function submitIdentity(userId, { identityType, identityNumber, docPath }) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return { error: 'User not found' };
  db.prepare(`UPDATE users SET identity_type = ?, identity_number_enc = ?, identity_doc_path = ?, identity_status = 'UNDER_REVIEW', updated_at = datetime('now') WHERE id = ?`)
    .run(identityType, identityNumber, docPath, userId);
  db.prepare('INSERT INTO verification_reviews (user_id, action, note) VALUES (?, ?, ?)').run(userId, 'UNDER_REVIEW', 'Identity submitted for review');
  return { status: 'UNDER_REVIEW' };
}

function reviewIdentity(userId, action, note, adminUserId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return { error: 'User not found' };
  const prev = { identity_status: user.identity_status };
  let newStatus;
  if (action === 'APPROVED') { newStatus = 'APPROVED'; db.prepare(`UPDATE users SET identity_status = 'APPROVED', identity_review_note = ?, identity_verified_at = datetime('now') WHERE id = ?`).run(note || null, userId); }
  else if (action === 'REJECTED') { newStatus = 'REJECTED'; db.prepare(`UPDATE users SET identity_status = 'REJECTED', identity_review_note = ? WHERE id = ?`).run(note || null, userId); }
  else if (action === 'REQUEST_RESUBMISSION') { newStatus = 'PENDING'; db.prepare(`UPDATE users SET identity_status = 'PENDING', identity_review_note = ? WHERE id = ?`).run(note || null, userId); }
  else return { error: 'Invalid action' };
  db.prepare('INSERT INTO verification_reviews (user_id, reviewer_id, action, note) VALUES (?, ?, ?, ?)').run(userId, adminUserId, action, note || null);
  notify(userId, 'account', 'Identity verification update', `Your identity verification status: ${newStatus}.`);
  return { status: newStatus, previous: prev };
}

module.exports = { submitIdentity, reviewIdentity };
