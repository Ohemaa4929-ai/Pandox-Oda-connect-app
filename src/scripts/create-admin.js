'use strict';
/** Bootstrap the SUPER_ADMIN from environment variables (first run only). */
const { db } = require('../db');
const config = require('../config');
const { hashPassword } = require('../security');

const email = config.adminEmail;
const password = config.adminPassword;
if (!email || !password || password === 'CHANGE_ME_STRONG_PASSWORD') {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD in .env (strong password) before creating the super admin.');
  process.exit(1);
}
const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
if (existing) {
  const admin = db.prepare('SELECT * FROM admin_users WHERE user_id = ?').get(existing.id);
  if (admin) { console.log('Super admin already exists.'); process.exit(0); }
  db.prepare('INSERT INTO admin_users (user_id, role) VALUES (?, ?)').run(existing.id, 'SUPER_ADMIN');
  console.log('Promoted existing user to SUPER_ADMIN.');
  process.exit(0);
}
const info = db.prepare('INSERT INTO users (email, password_hash, full_name, role, status) VALUES (?, ?, ?, ?, ?)')
  .run(email.toLowerCase().trim(), hashPassword(password), config.adminName, 'admin', 'ACTIVE');
db.prepare('INSERT INTO admin_users (user_id, role) VALUES (?, ?)').run(info.lastInsertRowid, 'SUPER_ADMIN');
console.log(`SUPER_ADMIN created: ${email}`);
