'use strict';
/**
 * PANDOX ODA CONNECT — main server.
 * Serves: customer/provider app (/) and owner dashboard (/admin) from ONE backend and ONE database.
 */
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const config = require('./src/config');
const { db } = require('./src/db');
const { hashPassword } = require('./src/security');
const { createRateLimiter } = require('./src/security');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: config.env === 'production' ? undefined : false,
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

// CORS for API clients
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && config.corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Global API rate limit
app.use('/api', createRateLimiter({ windowMs: 60 * 1000, max: 300, keyFn: (req) => req.ip }));

// Routes
app.use('/api/auth', require('./src/routes/auth.routes'));
app.use('/api/catalog', require('./src/routes/catalog.routes'));
app.use('/api/bookings', require('./src/routes/booking.routes'));
app.use('/api/provider', require('./src/routes/provider.routes'));
app.use('/api/payments', require('./src/routes/payment.routes'));
app.use('/api/disputes', require('./src/routes/dispute.routes'));
app.use('/api/user', require('./src/routes/user.routes'));
app.use('/api/admin', require('./src/routes/admin.routes'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'PANDOX ODA CONNECT', time: new Date().toISOString() });
});

// Static: customer/provider app
app.use(express.static(path.join(__dirname, 'public')));
// Static: owner dashboard
app.use('/admin', express.static(path.join(__dirname, 'admin')));
// Uploaded files (served only when they exist)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// SPA fallbacks
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin', 'index.html')));

// 404 for unknown API
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Auto-bootstrap super admin on first boot if env vars are set
(function bootstrapAdmin() {
  if (config.adminEmail && config.adminPassword && config.adminPassword !== 'CHANGE_ME_STRONG_PASSWORD') {
    const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(config.adminEmail.toLowerCase().trim());
    if (!existing) {
      const info = db.prepare('INSERT INTO users (email, password_hash, full_name, role, status) VALUES (?, ?, ?, ?, ?)')
        .run(config.adminEmail.toLowerCase().trim(), hashPassword(config.adminPassword), config.adminName, 'admin', 'ACTIVE');
      db.prepare('INSERT INTO admin_users (user_id, role) VALUES (?, ?)').run(info.lastInsertRowid, 'SUPER_ADMIN');
      console.log('[bootstrap] SUPER_ADMIN created from environment variables.');
    } else {
      const admin = db.prepare('SELECT * FROM admin_users WHERE user_id = ?').get(existing.id);
      if (!admin) db.prepare('INSERT INTO admin_users (user_id, role) VALUES (?, ?)').run(existing.id, 'SUPER_ADMIN');
      // Keep the owner account active — protects against accidental deactivation from the dashboard.
      if (existing.status !== 'ACTIVE') {
        db.prepare("UPDATE users SET status = 'ACTIVE', updated_at = datetime('now') WHERE id = ?").run(existing.id);
        console.log('[bootstrap] SUPER_ADMIN account reactivated.');
      }
      if (admin && admin.status !== 'ACTIVE') {
        db.prepare("UPDATE admin_users SET status = 'ACTIVE' WHERE user_id = ?").run(existing.id);
        console.log('[bootstrap] SUPER_ADMIN admin record reactivated.');
      }
    }
  }
})();

// Warn about missing configuration
if (!config.sessionSecret || config.sessionSecret.length < 32) console.warn('[config] WARNING: SESSION_SECRET is not set or too short. Sessions are insecure.');
if (!config.encryptionKey || config.encryptionKey.length !== 64) console.warn('[config] WARNING: ENCRYPTION_KEY is not set (needed for encrypted ID storage).');
if (!config.paystackSecretKey) console.warn('[config] Payments: NOT CONFIGURED (set PAYSTACK_SECRET_KEY). Payment endpoints will report NOT CONFIGURED.');

fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });

app.listen(config.port, () => {
  console.log(`PANDOX ODA CONNECT running on http://localhost:${config.port}`);
  console.log(`  Customer/Provider app: http://localhost:${config.port}/`);
  console.log(`  Owner Dashboard:       http://localhost:${config.port}/admin`);
});