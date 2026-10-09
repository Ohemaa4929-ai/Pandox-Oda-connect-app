'use strict';
/**
 * Chat — direct messaging between users.
 * Rules:
 *  - Owner (admin role) can start a conversation with ANY user.
 *  - A provider (APPROVED + ACTIVE subscription) can start a conversation with customers.
 *  - A customer can start a conversation with a provider (APPROVED + ACTIVE subscription) or with the owner.
 *  - Anyone in a conversation can reply and mark messages read.
 */
const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const { notify } = require('../services/notifications');
const router = express.Router();

/** Is this user the platform owner (admin role)? */
function isOwner(u) {
  return u.role === 'admin';
}

/** Provider record for a user, if any. */
function providerOf(userId) {
  return db.prepare('SELECT * FROM providers WHERE user_id = ?').get(userId);
}

/** Can this user start a conversation with the given target user? */
function canInitiate(me, target) {
  if (isOwner(me)) return true; // owner chats with everyone
  const p = providerOf(me.id);
  if (p && p.status === 'APPROVED' && p.subscription_status === 'ACTIVE' && target.role === 'customer') return true;
  // customer → provider (approved + subscribed) or customer → owner
  if (me.role === 'customer') {
    if (isOwner(target)) return true;
    const tp = providerOf(target.id);
    if (tp && tp.status === 'APPROVED' && tp.subscription_status === 'ACTIVE') return true;
  }
  return false;
}

function publicUser(u) {
  return { id: u.id, email: u.email, phone: u.phone, full_name: u.full_name, role: u.role, status: u.status };
}

function conversationRow(c) {
  return {
    id: c.id,
    other_id: c.other_id,
    other_name: c.other_name,
    other_email: c.other_email,
    other_role: c.other_role,
    last_message: c.last_message,
    last_message_at: c.last_message_at,
    unread: c.unread
  };
}

// GET /api/chat/conversations — my conversations with unread counts
router.get('/conversations', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT c.id,
           CASE WHEN c.user_a = ? THEN c.user_b ELSE c.user_a END AS other_id,
           u.full_name AS other_name, u.email AS other_email, u.role AS other_role,
           c.last_message, c.last_message_at,
           (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id AND m.sender_id != ? AND m.read = 0) AS unread
    FROM conversations c
    JOIN users u ON u.id = CASE WHEN c.user_a = ? THEN c.user_b ELSE c.user_a END
    WHERE c.user_a = ? OR c.user_b = ?
    ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
  `).all(req.user.id, req.user.id, req.user.id, req.user.id, req.user.id);
  res.json({ conversations: rows.map(conversationRow) });
});

// GET /api/chat/unread — total unread count (for nav badge)
router.get('/unread', requireAuth, (req, res) => {
  const row = db.prepare(`
    SELECT COUNT(*) c FROM chat_messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.sender_id != ? AND m.read = 0 AND (c.user_a = ? OR c.user_b = ?)
  `).get(req.user.id, req.user.id, req.user.id);
  res.json({ unread: row.c });
});

// GET /api/chat/conversations/:id/messages — thread messages
router.get('/conversations/:id/messages', requireAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!c || (c.user_a !== req.user.id && c.user_b !== req.user.id)) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  const messages = db.prepare(`
    SELECT m.*, u.full_name AS sender_name, u.role AS sender_role
    FROM chat_messages m JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = ? ORDER BY m.created_at ASC, m.id ASC
  `).all(c.id);
  res.json({ conversation: c, messages });
});

// POST /api/chat/conversations — start a conversation with a user
router.post('/conversations', requireAuth, (req, res) => {
  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Cannot chat with yourself' });
  if (target.status !== 'ACTIVE') return res.status(400).json({ error: 'That account is not active' });
  if (!canInitiate(req.user, target)) {
    return res.status(403).json({ error: 'You cannot start a conversation with this user' });
  }
  const a = Math.min(req.user.id, target.id);
  const b = Math.max(req.user.id, target.id);
  let c = db.prepare('SELECT * FROM conversations WHERE user_a = ? AND user_b = ?').get(a, b);
  if (!c) {
    const info = db.prepare('INSERT INTO conversations (user_a, user_b) VALUES (?, ?)').run(a, b);
    c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(info.lastInsertRowid);
  }
  res.json({ conversation: c });
});

// POST /api/chat/conversations/:id/messages — send a message
router.post('/conversations/:id/messages', requireAuth, (req, res) => {
  const { body } = req.body || {};
  if (!body || !String(body).trim()) return res.status(400).json({ error: 'message body is required' });
  const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!c || (c.user_a !== req.user.id && c.user_b !== req.user.id)) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  const text = String(body).trim().slice(0, 4000);
  const info = db.prepare('INSERT INTO chat_messages (conversation_id, sender_id, body) VALUES (?, ?, ?)')
    .run(c.id, req.user.id, text);
  db.prepare("UPDATE conversations SET last_message = ?, last_message_at = datetime('now') WHERE id = ?")
    .run(text, c.id);
  const otherId = c.user_a === req.user.id ? c.user_b : c.user_a;
  notify(otherId, 'chat', 'New message', `${req.user.full_name || req.user.email}: ${text}`);
  const msg = db.prepare(`
    SELECT m.*, u.full_name AS sender_name, u.role AS sender_role
    FROM chat_messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?
  `).get(info.lastInsertRowid);
  res.json({ message: msg });
});

// POST /api/chat/conversations/:id/read — mark all messages in a conversation as read
router.post('/conversations/:id/read', requireAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!c || (c.user_a !== req.user.id && c.user_b !== req.user.id)) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  db.prepare('UPDATE chat_messages SET read = 1 WHERE conversation_id = ? AND sender_id != ?')
    .run(c.id, req.user.id);
  res.json({ ok: true });
});

// GET /api/chat/users — who can I start a conversation with? (search by name/email)
router.get('/users', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim();
  let sql = `SELECT id, email, phone, full_name, role, status FROM users WHERE status = 'ACTIVE' AND id != ?`;
  const params = [req.user.id];
  if (q) { sql += ' AND (full_name LIKE ? OR email LIKE ? OR phone LIKE ?)'; const like = `%${q}%`; params.push(like, like, like); }
  const users = db.prepare(sql + ' ORDER BY full_name LIMIT 50').all(...params);
  const me = req.user;
  const p = providerOf(me.id);
  const meProvider = !!(p && p.status === 'APPROVED' && p.subscription_status === 'ACTIVE');
  const filtered = users.filter(t => canInitiate(me, t));
  res.json({ users: filtered.map(publicUser), me: { id: me.id, role: me.role, provider: meProvider } });
});

module.exports = router;