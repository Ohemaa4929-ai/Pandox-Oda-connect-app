'use strict';
/** Central configuration. All secrets come from environment variables — never hardcoded. */
const path = require('path');
const fs = require('fs');

// Load .env if present (no dependency needed)
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  env: process.env.NODE_ENV || 'development',
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map(s => s.trim()),
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'pandox.db'),
  sessionSecret: process.env.SESSION_SECRET || '',
  encryptionKey: process.env.ENCRYPTION_KEY || '',
  adminEmail: process.env.ADMIN_EMAIL || '',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  adminName: process.env.ADMIN_NAME || 'PANDOX Owner',
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY || '',
  paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY || '',
  paystackWebhookSecret: process.env.PAYSTACK_WEBHOOK_SECRET || '',
  smtp: { host: process.env.SMTP_HOST || '', port: parseInt(process.env.SMTP_PORT || '587', 10), user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '', from: process.env.MAIL_FROM || 'PANDOX ODA CONNECT <no-reply@pandoxoda.com>' },
  sms: { provider: process.env.SMS_PROVIDER || '', apiKey: process.env.SMS_API_KEY || '', from: process.env.SMS_FROM || '' },
  mapsApiKey: process.env.MAPS_API_KEY || '',
  uploadDir: process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads')
};

module.exports = config;
