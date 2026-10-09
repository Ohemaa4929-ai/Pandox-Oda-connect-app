'use strict';
/**
 * Database layer — SQLite (node:sqlite), WAL mode, foreign keys on.
 * ONE shared database powers both the customer/provider app and the owner dashboard.
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { encryptSecret, decryptSecret } = require('./security');

const dbPath = config.dbPath;
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  email_verified INTEGER NOT NULL DEFAULT 0,
  phone_verified INTEGER NOT NULL DEFAULT 0,
  identity_type TEXT,
  identity_number_enc TEXT,
  identity_doc_path TEXT,
  identity_status TEXT NOT NULL DEFAULT 'NONE',
  identity_review_note TEXT,
  identity_verified_at TEXT,
  two_factor_secret TEXT,
  two_factor_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  provider_type TEXT NOT NULL DEFAULT 'other',
  business_name TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',
  subscription_status TEXT NOT NULL DEFAULT 'NONE',
  subscription_start TEXT,
  subscription_expiry TEXT,
  subscription_grace_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  city TEXT,
  latitude REAL,
  longitude REAL,
  price_per_night REAL,
  price_per_month REAL,
  price_per_km REAL,
  base_fee REAL,
  is_featured INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  name TEXT NOT NULL,
  description TEXT,
  price_per_night REAL NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1,
  available INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  make TEXT NOT NULL,
  model TEXT,
  year INTEGER,
  color TEXT,
  plate_number TEXT NOT NULL,
  vehicle_type TEXT NOT NULL DEFAULT 'car',
  seats INTEGER NOT NULL DEFAULT 4,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS availability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  date TEXT NOT NULL,
  available INTEGER NOT NULL DEFAULT 1,
  UNIQUE(listing_id, date)
);

CREATE TABLE IF NOT EXISTS listing_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  file_path TEXT NOT NULL,
  is_cover INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_ref TEXT UNIQUE NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES users(id),
  provider_id INTEGER REFERENCES providers(id),
  listing_id INTEGER REFERENCES listings(id),
  room_id INTEGER REFERENCES rooms(id),
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  pickup_location TEXT,
  destination TEXT,
  package_info TEXT,
  check_in TEXT,
  check_out TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  amount REAL NOT NULL DEFAULT 0,
  notes TEXT,
  rating INTEGER,
  review TEXT,
  cancellation_reason TEXT,
  cancelled_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS ride_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  status TEXT NOT NULL DEFAULT 'SEARCHING',
  accepted_by INTEGER REFERENCES providers(id),
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS delivery_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  status TEXT NOT NULL DEFAULT 'PENDING',
  accepted_by INTEGER REFERENCES providers(id),
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS financial_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  txn_ref TEXT UNIQUE NOT NULL,
  customer_id INTEGER REFERENCES users(id),
  provider_id INTEGER REFERENCES providers(id),
  booking_id INTEGER REFERENCES bookings(id),
  subscription_id INTEGER REFERENCES subscriptions(id),
  type TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  platform_fee REAL NOT NULL DEFAULT 0,
  provider_amount REAL NOT NULL DEFAULT 0,
  gateway TEXT,
  gateway_reference TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  refund_status TEXT,
  settlement_status TEXT,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS subscription_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  audience TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  billing_period_days INTEGER NOT NULL DEFAULT 30,
  trial_days INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  plan_id INTEGER NOT NULL REFERENCES subscription_plans(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  starts_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  grace_until TEXT,
  payment_status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT,
  updated_by INTEGER
);

CREATE TABLE IF NOT EXISTS platform_controls (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT 'off'
);

CREATE TABLE IF NOT EXISTS commission_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT UNIQUE NOT NULL,
  percent REAL NOT NULL DEFAULT 0,
  fixed_fee REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS disputes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dispute_ref TEXT UNIQUE NOT NULL,
  booking_id INTEGER REFERENCES bookings(id),
  transaction_id INTEGER REFERENCES financial_transactions(id),
  raised_by INTEGER NOT NULL REFERENCES users(id),
  against_user_id INTEGER REFERENCES users(id),
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  resolution TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS dispute_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dispute_id INTEGER NOT NULL REFERENCES disputes(id),
  author_id INTEGER NOT NULL REFERENCES users(id),
  note TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  content TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS policy_acceptances (
  user_id INTEGER NOT NULL REFERENCES users(id),
  policy_id INTEGER NOT NULL REFERENCES policies(id),
  version INTEGER NOT NULL,
  accepted_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, policy_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  channel TEXT NOT NULL DEFAULT 'in_app',
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notification_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL,
  target_user_ids TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'SUPPORT_ADMIN',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS verification_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  reviewer_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  refund_ref TEXT UNIQUE NOT NULL,
  transaction_id INTEGER NOT NULL REFERENCES financial_transactions(id),
  amount REAL NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'REQUESTED',
  processed_by INTEGER REFERENCES users(id),
  gateway_reference TEXT,
  processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  previous_state TEXT,
  new_state TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

/* ---------------- helpers ---------------- */

function getSetting(key) {
  const row = db.prepare('SELECT value FROM platform_settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value, byUserId) {
  db.prepare(`INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES (?, ?, datetime('now'), ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now'), updated_by = excluded.updated_by`)
    .run(key, String(value), byUserId || null);
}

function getControl(key) {
  const row = db.prepare('SELECT value FROM platform_controls WHERE key = ?').get(key);
  return row ? row.value : 'off';
}

function setControl(key, value) {
  db.prepare(`INSERT INTO platform_controls (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value === 'on' ? 'on' : 'off');
}

/** Encrypt/decrypt sensitive values at rest (national ID numbers). */
function encryptId(plain) { return encryptSecret(plain); }
function decryptId(payload) { return decryptSecret(payload); }

/* ---------------- seed ---------------- */

function seed() {
  // Subscription plans (owner-configurable from dashboard)
  const planCount = db.prepare('SELECT COUNT(*) c FROM subscription_plans').get().c;
  if (planCount === 0) {
    db.prepare(`INSERT INTO subscription_plans (name, audience, price, billing_period_days, trial_days, active, description)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run('Customer Subscription', 'customer', 0, 30, 0, 1, 'Access to the PANDOX ODA CONNECT marketplace.');
    db.prepare(`INSERT INTO subscription_plans (name, audience, price, billing_period_days, trial_days, active, description)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run('Provider Subscription (3 months)', 'provider', 0, 90, 0, 1, 'Operate as a verified provider on the platform.');
  }

  // Commission rules (owner-configurable)
  const commCount = db.prepare('SELECT COUNT(*) c FROM commission_rules').get().c;
  if (commCount === 0) {
    const rules = [
      ['ride', 10, 0], ['delivery', 10, 0], ['hotel', 8, 0], ['short_stay', 8, 0],
      ['apartment', 5, 0], ['property', 5, 0], ['other', 10, 0]
    ];
    const stmt = db.prepare('INSERT INTO commission_rules (category, percent, fixed_fee, active) VALUES (?, ?, ?, 1)');
    for (const [cat, pct, fee] of rules) stmt.run(cat, pct, fee);
  }

  // Platform settings defaults
  const defaults = {
    platform_name: 'PANDOX ODA CONNECT',
    platform_tagline: 'Everything in Akim Oda. One platform.',
    support_email: 'support@pandoxoda.com',
    support_phone: '',
    marketplace_disclaimer: 'PANDOX ODA CONNECT is a marketplace connecting customers with independent service providers.',
    listing_approval_required: '1',
    cancellation_window_minutes: '60',
    cancellation_fee_percent: '10',
    ride_estimation_enabled: '1',
    maps_enabled: '0',
    email_enabled: '0',
    sms_enabled: '0',
    push_enabled: '1',
    payments_enabled: '0',
    customer_subscription_price: '0',
    customer_subscription_period_days: '30',
    customer_subscription_trial_days: '0',
    customer_subscription_active: '1',
    provider_subscription_price: '0',
    provider_subscription_period_days: '90',
    provider_subscription_grace_days: '7',
    provider_subscription_active: '1'
  };
  const stmt = db.prepare('INSERT OR IGNORE INTO platform_settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) stmt.run(k, v);

  // Platform controls (all off by default)
  const controls = ['registrations', 'bookings', 'payments', 'provider_registrations', 'transportation', 'delivery', 'hotels', 'short_stay', 'property', 'maintenance'];
  const cstmt = db.prepare('INSERT OR IGNORE INTO platform_controls (key, value) VALUES (?, ?)');
  for (const k of controls) cstmt.run(k, 'off');

  // Legal policies (13, versioned, Ghanaian requirements)
  const polCount = db.prepare('SELECT COUNT(*) c FROM policies').get().c;
  if (polCount === 0) {
    const policies = [
      ['terms_of_service', 'Terms of Service', 'Terms governing use of the PANDOX ODA CONNECT platform.'],
      ['privacy_policy', 'Privacy Policy', 'How we collect, use and protect your personal data.'],
      ['cookie_policy', 'Cookie Policy', 'How cookies are used on the platform.'],
      ['refund_policy', 'Refund Policy', 'Refund rules for bookings and payments.'],
      ['cancellation_policy', 'Cancellation Policy', 'Cancellation windows and fees.'],
      ['provider_terms', 'Provider Terms', 'Terms for service providers operating on the platform.'],
      ['driver_terms', 'Driver Terms', 'Terms for transportation and ride providers.'],
      ['delivery_terms', 'Delivery Terms', 'Terms for delivery providers.'],
      ['hotel_terms', 'Hotel & Short-stay Terms', 'Terms for hotel and short-stay operators.'],
      ['property_terms', 'Property & Rental Terms', 'Terms for apartment and property providers.'],
      ['dispute_resolution', 'Dispute Resolution Policy', 'How disputes between users are resolved.'],
      ['acceptable_use', 'Acceptable Use Policy', 'Rules for acceptable use of the platform.'],
      ['data_protection', 'Data Protection Policy', 'Data protection obligations under Ghanaian law (Data Protection Act, 2012).']
    ];
    const stmt = db.prepare('INSERT INTO policies (slug, title, version, content, active) VALUES (?, ?, 1, ?, 1)');
    for (const [slug, title, content] of policies) stmt.run(slug, title, content);
  }
}

seed();

module.exports = { db, getSetting, setSetting, getControl, setControl, encryptId, decryptId, seed };
