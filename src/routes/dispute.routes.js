'use strict';
/** Disputes: customers and providers can raise; full record kept. */
const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const { notify } = require('../services/notifications');
const router = express.Router();

function ref(prefix) { return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; }

// POST /api/disputes — raise a dispute
router.post('/', requireAuth, (req, res) => {
  const { booking_id, transaction_id, category, description, against_user_id } = req.body || {};
  if (!category || !description) return res.status(400).json({ error: 'category and description are required' });
  const disputeRef = ref('DSP');
  const info = db.prepare(`INSERT INTO disputes (dispute_ref, booking_id, transaction_id, raised_by, against_user_id, category, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(disputeRef, booking_id || null, transaction_id || null, req.user.id, against_user_id || null, category, description);
  notify(req.user.id, 'dispute', 'Dispute opened', `Your dispute ${disputeRef} has been opened.`);
  res.status(201).json({ dispute: db.prepare('SELECT * FROM disputes WHERE id = ?').get(info.lastInsertRowid) });
});

// GET /api/disputes/mine
router.get('/mine', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM disputes WHERE raised_by = ? OR against_user_id = ? ORDER BY created_at DESC').all(req.user.id, req.user.id);
  res.json({ disputes: rows });
});

// GET /api/disputes/:id
router.get('/:id', requireAuth, (req, res) => {
  const d = db.prepare('SELECT * FROM disputes WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Dispute not found' });
  if (d.raised_by !== req.user.id && d.against_user_id !== req.user.id) return res.status(403).json({ error: 'Not your dispute' });
  const notes = db.prepare('SELECT * FROM dispute_notes WHERE dispute_id = ? ORDER BY created_at').all(d.id);
  res.json({ dispute: d, notes });
});

// POST /api/disputes/:id/notes — add a note (customer/provider side)
router.post('/:id/notes', requireAuth, (req, res) => {
  const d = db.prepare('SELECT * FROM disputes WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Dispute not found' });
  if (d.raised_by !== req.user.id && d.against_user_id !== req.user.id) return res.status(403).json({ error: 'Not your dispute' });
  const { note } = req.body || {};
  if (!note) return res.status(400).json({ error: 'note is required' });
  db.prepare('INSERT INTO dispute_notes (dispute_id, author_id, note) VALUES (?, ?, ?)').run(d.id, req.user.id, note);
  res.status(201).json({ ok: true });
});

module.exports = router;
