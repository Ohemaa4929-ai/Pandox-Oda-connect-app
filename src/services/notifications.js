'use strict';
/** Notification service: in-app always; email/SMS only when configured. */
const { db } = require('../db');
const config = require('../config');

function getSetting(key) {
  const row = db.prepare('SELECT value FROM platform_settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function notify(userId, type, title, body, channel = 'in_app') {
  db.prepare('INSERT INTO notifications (user_id, type, title, body, channel) VALUES (?, ?, ?, ?, ?)')
    .run(userId, type, title, body, channel);
  // Email / SMS dispatch hooks — implemented when SMTP/SMS providers are configured.
  if (channel === 'email' && config.smtp.host) { /* sendEmail(...) */ }
  if (channel === 'sms' && config.sms.provider) { /* sendSms(...) */ }
}

function notifyMany(userIds, type, title, body, channel = 'in_app') {
  const stmt = db.prepare('INSERT INTO notifications (user_id, type, title, body, channel) VALUES (?, ?, ?, ?, ?)');
  for (const uid of userIds) stmt.run(uid, type, title, body, channel);
}

function sendCampaign(campaignId) {
  const c = db.prepare('SELECT * FROM notification_campaigns WHERE id = ?').get(campaignId);
  if (!c || c.status !== 'DRAFT') return { error: 'Campaign not found or already sent' };
  let ids = [];
  if (c.audience === 'all') ids = db.prepare('SELECT id FROM users WHERE status = ?').all('ACTIVE').map(r => r.id);
  else if (c.audience === 'customers') ids = db.prepare('SELECT id FROM users WHERE role = ? AND status = ?').all('customer', 'ACTIVE').map(r => r.id);
  else if (c.audience === 'providers') ids = db.prepare('SELECT id FROM users WHERE role = ? AND status = ?').all('provider', 'ACTIVE').map(r => r.id);
  else if (c.audience === 'specific' && c.target_user_ids) ids = c.target_user_ids.split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean);
  notifyMany(ids, 'announcement', c.title, c.body);
  db.prepare('UPDATE notification_campaigns SET status = ?, sent_at = ? WHERE id = ?').run('SENT', new Date().toISOString(), campaignId);
  return { sent: ids.length };
}

module.exports = { notify, notifyMany, sendCampaign, getSetting };
