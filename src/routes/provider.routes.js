'use strict';
/** Provider operations: profile, listings, vehicles, availability, earnings, accept jobs. */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const { notify } = require('../services/notifications');
const router = express.Router();

const MEDIA_MIME_EXTENSIONS = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov', 'video/x-msvideo': '.avi'
};
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(config.uploadDir, 'providers', String(req.provider.id), String(req.listing.id));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = MEDIA_MIME_EXTENSIONS[file.mimetype] || '';
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    }
  }),
  limits: { files: 8, fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!MEDIA_MIME_EXTENSIONS[file.mimetype]) return cb(new Error('Only JPG, PNG, WEBP, GIF, MP4, WEBM, MOV or AVI files are allowed.'));
    cb(null, true);
  }
});

function requireProvider(req, res, next) {
  const p = db.prepare('SELECT * FROM providers WHERE user_id = ?').get(req.user.id);
  if (!p) return res.status(403).json({ error: 'Provider account required' });
  if (p.status !== 'APPROVED') return res.status(403).json({ error: `Provider account is ${p.status}. Approval required.` });
  if (p.subscription_status === 'SUSPENDED' || p.subscription_status === 'EXPIRED') return res.status(403).json({ error: 'Provider subscription is not active. Renew to continue operating.' });
  req.provider = p;
  next();
}

// GET /api/provider/me
router.get('/me', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM providers WHERE user_id = ?').get(req.user.id);
  if (!p) return res.status(404).json({ error: 'No provider account' });
  res.json({ provider: p });
});

// PUT /api/provider/me — update profile
router.put('/me', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM providers WHERE user_id = ?').get(req.user.id);
  if (!p) return res.status(404).json({ error: 'No provider account' });
  const { business_name, description, phone } = req.body || {};
  if (business_name !== undefined) db.prepare('UPDATE providers SET business_name = ? WHERE id = ?').run(business_name, p.id);
  if (description !== undefined) db.prepare('UPDATE providers SET description = ? WHERE id = ?').run(description, p.id);
  if (phone !== undefined) db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(phone, req.user.id);
  res.json({ provider: db.prepare('SELECT * FROM providers WHERE id = ?').get(p.id) });
});

// POST /api/provider/vehicles — add vehicle (drivers)
router.post('/vehicles', requireAuth, requireProvider, (req, res) => {
  const { make, model, year, color, plate_number, vehicle_type, seats } = req.body || {};
  if (!make || !plate_number) return res.status(400).json({ error: 'make and plate_number are required' });
  const info = db.prepare('INSERT INTO vehicles (provider_id, make, model, year, color, plate_number, vehicle_type, seats) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.provider.id, make, model || null, year || null, color || null, plate_number, vehicle_type || 'car', seats || 4);
  res.status(201).json({ vehicle: db.prepare('SELECT * FROM vehicles WHERE id = ?').get(info.lastInsertRowid) });
});

// GET /api/provider/vehicles
router.get('/vehicles', requireAuth, requireProvider, (req, res) => {
  res.json({ vehicles: db.prepare('SELECT * FROM vehicles WHERE provider_id = ?').all(req.provider.id) });
});

// POST /api/provider/listings — create listing (approval required per settings)
router.post('/listings', requireAuth, requireProvider, (req, res) => {
  const { category, title, description, location, city, price_per_night, price_per_month, price_per_km, base_fee, latitude, longitude } = req.body || {};
  if (!category || !title) return res.status(400).json({ error: 'category and title are required' });
  const approvalRequired = getSetting('listing_approval_required') === '1';
  const status = approvalRequired ? 'PENDING' : 'APPROVED';
  const info = db.prepare(`INSERT INTO listings (provider_id, category, title, description, location, city, latitude, longitude, price_per_night, price_per_month, price_per_km, base_fee, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.provider.id, category, title, description || null, location || null, city || 'Akim Oda',
      latitude || null, longitude || null, price_per_night || null, price_per_month || null, price_per_km || null, base_fee || null, status);
  const listingId = info.lastInsertRowid;
  if (status === 'PENDING') notify(req.user.id, 'listing', 'Listing submitted for approval', `Your listing "${title}" is pending approval.`);
  res.status(201).json({ listing: db.prepare('SELECT * FROM listings WHERE id = ?').get(listingId) });
});

// GET /api/provider/listings
router.get('/listings', requireAuth, requireProvider, (req, res) => {
  res.json({ listings: db.prepare('SELECT * FROM listings WHERE provider_id = ? ORDER BY created_at DESC').all(req.provider.id) });
});

// PUT /api/provider/listings/:id
router.put('/listings/:id', requireAuth, requireProvider, (req, res) => {
  const l = db.prepare('SELECT * FROM listings WHERE id = ? AND provider_id = ?').get(req.params.id, req.provider.id);
  if (!l) return res.status(404).json({ error: 'Listing not found' });
  const { title, description, location, price_per_night, price_per_month, price_per_km, base_fee, is_featured } = req.body || {};
  if (title !== undefined) db.prepare('UPDATE listings SET title = ? WHERE id = ?').run(title, l.id);
  if (description !== undefined) db.prepare('UPDATE listings SET description = ? WHERE id = ?').run(description, l.id);
  if (location !== undefined) db.prepare('UPDATE listings SET location = ? WHERE id = ?').run(location, l.id);
  if (price_per_night !== undefined) db.prepare('UPDATE listings SET price_per_night = ? WHERE id = ?').run(price_per_night, l.id);
  if (price_per_month !== undefined) db.prepare('UPDATE listings SET price_per_month = ? WHERE id = ?').run(price_per_month, l.id);
  if (price_per_km !== undefined) db.prepare('UPDATE listings SET price_per_km = ? WHERE id = ?').run(price_per_km, l.id);
  if (base_fee !== undefined) db.prepare('UPDATE listings SET base_fee = ? WHERE id = ?').run(base_fee, l.id);
  if (is_featured !== undefined) db.prepare('UPDATE listings SET is_featured = ? WHERE id = ?').run(is_featured ? 1 : 0, l.id);
  res.json({ listing: db.prepare('SELECT * FROM listings WHERE id = ?').get(l.id) });
});

// POST /api/provider/rooms — add room to hotel/short-stay listing
router.post('/listings/:id/rooms', requireAuth, requireProvider, (req, res) => {
  const l = db.prepare('SELECT * FROM listings WHERE id = ? AND provider_id = ?').get(req.params.id, req.provider.id);
  if (!l) return res.status(404).json({ error: 'Listing not found' });
  const { name, description, price_per_night, capacity } = req.body || {};
  if (!name || !price_per_night) return res.status(400).json({ error: 'name and price_per_night are required' });
  const info = db.prepare('INSERT INTO rooms (listing_id, name, description, price_per_night, capacity) VALUES (?, ?, ?, ?, ?)')
    .run(l.id, name, description || null, price_per_night, capacity || 1);
  res.status(201).json({ room: db.prepare('SELECT * FROM rooms WHERE id = ?').get(info.lastInsertRowid) });
});

// POST /api/provider/availability — set availability for a date
router.post('/listings/:id/availability', requireAuth, requireProvider, (req, res) => {
  const l = db.prepare('SELECT * FROM listings WHERE id = ? AND provider_id = ?').get(req.params.id, req.provider.id);
  if (!l) return res.status(404).json({ error: 'Listing not found' });
  const { date, available } = req.body || {};
  if (!date) return res.status(400).json({ error: 'date is required' });
  db.prepare('INSERT INTO availability (listing_id, date, available) VALUES (?, ?, ?) ON CONFLICT(listing_id, date) DO UPDATE SET available = excluded.available')
    .run(l.id, date, available ? 1 : 0);
  res.json({ ok: true });
});

// Upload listing media. Approval and an active provider subscription are required.
router.post('/listings/:id/media', requireAuth, requireProvider, (req, res, next) => {
  req.listing = db.prepare('SELECT * FROM listings WHERE id = ? AND provider_id = ?').get(req.params.id, req.provider.id);
  if (!req.listing) return res.status(404).json({ error: 'Listing not found' });
  upload.array('media', 8)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Each media file must be 50 MB or smaller.' : err.message });
    next();
  });
}, (req, res) => {
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'Select at least one image or video.' });
  const media = [];
  try {
    for (const file of req.files) {
      const mediaType = file.mimetype.startsWith('video/') ? 'video' : 'image';
      const relative = path.relative(config.uploadDir, file.path).split(path.sep).join('/');
      const filePath = `/uploads/${relative}`;
      const info = db.prepare(`INSERT INTO listing_media
        (listing_id, file_path, media_type, mime_type, file_size, original_name, is_cover)
        VALUES (?, ?, ?, ?, ?, ?, ?)` ).run(req.listing.id, filePath, mediaType, file.mimetype, file.size, file.originalname, media.length === 0 ? 1 : 0);
      media.push(db.prepare('SELECT * FROM listing_media WHERE id = ?').get(info.lastInsertRowid));
    }
    res.status(201).json({ media });
  } catch (e) {
    for (const file of req.files) fs.rmSync(file.path, { force: true });
    console.error('[provider media upload]', e);
    res.status(500).json({ error: 'Media could not be saved.' });
  }
});

// List media for an owned listing.
router.get('/listings/:id/media', requireAuth, requireProvider, (req, res) => {
  const listing = db.prepare('SELECT id FROM listings WHERE id = ? AND provider_id = ?').get(req.params.id, req.provider.id);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });
  res.json({ media: db.prepare('SELECT * FROM listing_media WHERE listing_id = ? ORDER BY is_cover DESC, created_at ASC').all(listing.id) });
});

// Delete media owned by the provider.
router.delete('/listings/:listingId/media/:mediaId', requireAuth, requireProvider, (req, res) => {
  const media = db.prepare(`SELECT m.* FROM listing_media m JOIN listings l ON l.id = m.listing_id
    WHERE m.id = ? AND m.listing_id = ? AND l.provider_id = ?`).get(req.params.mediaId, req.params.listingId, req.provider.id);
  if (!media) return res.status(404).json({ error: 'Media not found' });
  const diskPath = path.join(config.uploadDir, media.file_path.replace(/^\/uploads\//, ''));
  db.prepare('DELETE FROM listing_media WHERE id = ?').run(media.id);
  fs.rmSync(diskPath, { force: true });
  res.json({ ok: true });
});

// GET /api/provider/bookings — bookings for this provider
router.get('/bookings', requireAuth, requireProvider, (req, res) => {
  const rows = db.prepare('SELECT * FROM bookings WHERE provider_id = ? ORDER BY created_at DESC LIMIT 100').all(req.provider.id);
  res.json({ bookings: rows });
});

// POST /api/provider/bookings/:id/accept — accept ride/delivery job
router.post('/bookings/:id/accept', requireAuth, requireProvider, (req, res) => {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  if (b.provider_id && b.provider_id !== req.provider.id) return res.status(403).json({ error: 'Booking not available for this provider' });
  if (b.category === 'ride') {
    const r = db.prepare('SELECT * FROM ride_requests WHERE booking_id = ?').get(b.id);
    if (!r || r.status !== 'SEARCHING') return res.status(400).json({ error: 'Ride is not available for acceptance' });
    db.prepare(`UPDATE ride_requests SET status = 'ACCEPTED', accepted_by = ?, accepted_at = datetime('now') WHERE booking_id = ?`).run(req.provider.id, b.id);
  } else if (b.category === 'delivery') {
    const d = db.prepare('SELECT * FROM delivery_orders WHERE booking_id = ?').get(b.id);
    if (!d || d.status !== 'PENDING') return res.status(400).json({ error: 'Delivery is not available for acceptance' });
    db.prepare(`UPDATE delivery_orders SET status = 'ACCEPTED', accepted_by = ?, accepted_at = datetime('now') WHERE booking_id = ?`).run(req.provider.id, b.id);
  } else return res.status(400).json({ error: 'Only ride and delivery bookings can be accepted' });
  db.prepare(`UPDATE bookings SET provider_id = ?, status = 'IN_PROGRESS', updated_at = datetime('now') WHERE id = ?`).run(req.provider.id, b.id);
  notify(b.customer_id, 'booking', 'Booking accepted', `Your ${b.category} booking was accepted by ${req.provider.business_name || 'your provider'}.`);
  res.json({ ok: true });
});

// POST /api/provider/bookings/:id/status — update delivery status
router.post('/bookings/:id/status', requireAuth, requireProvider, (req, res) => {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  if (b.provider_id && b.provider_id !== req.provider.id) return res.status(403).json({ error: 'Booking not available for this provider' });
  const { status } = req.body || {};
  const allowed = ['PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'];
  if (!allowed.includes(status)) return res.status(400).json({ error: `Invalid status. Allowed: ${allowed.join(', ')}` });
  if (b.category === 'delivery') {
    db.prepare('UPDATE delivery_orders SET status = ? WHERE booking_id = ?').run(status === 'COMPLETED' ? 'DELIVERED' : status, b.id);
  }
  db.prepare(`UPDATE bookings SET status = ?, completed_at = CASE WHEN ? = 'COMPLETED' THEN datetime('now') ELSE completed_at END, updated_at = datetime('now') WHERE id = ?`).run(status, status, b.id);
  if (status === 'COMPLETED') notify(b.customer_id, 'booking', 'Booking completed', `Your ${b.category} booking is complete. Please rate your provider.`);
  res.json({ ok: true });
});

// GET /api/provider/earnings
router.get('/earnings', requireAuth, requireProvider, (req, res) => {
  const txns = db.prepare(`SELECT * FROM financial_transactions WHERE provider_id = ? AND status = 'SUCCESSFUL' ORDER BY created_at DESC LIMIT 200`).all(req.provider.id);
  const total = txns.reduce((s, t) => s + t.provider_amount, 0);
  const settled = txns.filter(t => t.settlement_status === 'SETTLED').reduce((s, t) => s + t.provider_amount, 0);
  res.json({ earnings: txns, total_provider_amount: Math.round(total * 100) / 100, settled: Math.round(settled * 100) / 100 });
});

function getSetting(key) {
  const row = db.prepare('SELECT value FROM platform_settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

module.exports = router;
