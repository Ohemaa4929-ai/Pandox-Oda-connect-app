const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { db, all, get, run } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { providerSubscriptionStatus, hasActiveProviderSubscription } = require('../services/subscriptions');
const { config } = require('../config');

const router = express.Router();

function requireProvider(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  const provider = get(`SELECT * FROM providers WHERE user_id = ?`, [req.user.id]);
  if (!provider) return res.status(403).json({ error: 'Provider profile required' });
  if (provider.status !== 'APPROVED') return res.status(403).json({ error: 'Provider approval required' });
  const subscription = providerSubscriptionStatus(provider.id);
  if (!hasActiveProviderSubscription(provider.id)) {
    return res.status(403).json({ error: 'An active provider subscription is required', code: 'SUBSCRIPTION_REQUIRED', subscription });
  }
  req.provider = provider;
  req.providerSubscription = subscription;
  next();
}

router.use(requireAuth);

router.get('/me', (req, res) => {
  const provider = get(`SELECT * FROM providers WHERE user_id = ?`, [req.user.id]);
  if (!provider) return res.status(404).json({ error: 'Provider profile not found' });
  res.json({ provider, subscription: providerSubscriptionStatus(provider.id) });
});

router.get('/listings', requireProvider, (req, res) => {
  const listings = all(`SELECT * FROM listings WHERE provider_id = ? ORDER BY created_at DESC`, [req.provider.id]);
  res.json({ listings });
});

router.post('/listings', requireProvider, (req, res) => {
  const { title, category, description, location, price, currency, listing_type, bedrooms, bathrooms, area, amenities, contact_phone } = req.body;
  if (!title || !category) return res.status(400).json({ error: 'Title and category are required' });
  const result = run(`INSERT INTO listings (provider_id, title, category, description, location, price, currency, listing_type, bedrooms, bathrooms, area, amenities, contact_phone, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`, [req.provider.id, title, category, description || '', location || '', Number(price) || 0, currency || 'GHS', listing_type || 'OTHER', bedrooms || null, bathrooms || null, area || null, amenities || '', contact_phone || '']);
  res.status(201).json({ listing: get(`SELECT * FROM listings WHERE id = ?`, [result.lastInsertRowid]) });
});

router.patch('/listings/:id', requireProvider, (req, res) => {
  const listing = get(`SELECT * FROM listings WHERE id = ? AND provider_id = ?`, [req.params.id, req.provider.id]);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });
  const allowed = ['title', 'category', 'description', 'location', 'price', 'currency', 'listing_type', 'bedrooms', 'bathrooms', 'area', 'amenities', 'contact_phone', 'status'];
  const updates = [];
  const values = [];
  for (const field of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, field)) {
      updates.push(`${field} = ?`);
      values.push(req.body[field]);
    }
  }
  if (!updates.length) return res.status(400).json({ error: 'No changes supplied' });
  values.push(req.params.id, req.provider.id);
  run(`UPDATE listings SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND provider_id = ?`, values);
  res.json({ listing: get(`SELECT * FROM listings WHERE id = ?`, [req.params.id]) });
});

router.delete('/listings/:id', requireProvider, (req, res) => {
  const listing = get(`SELECT * FROM listings WHERE id = ? AND provider_id = ?`, [req.params.id, req.provider.id]);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });
  run(`DELETE FROM listings WHERE id = ? AND provider_id = ?`, [req.params.id, req.provider.id]);
  res.json({ ok: true });
});

router.get('/bookings', requireProvider, (req, res) => {
  const bookings = all(`SELECT b.*, l.title AS listing_title, u.name AS customer_name, u.email AS customer_email FROM bookings b JOIN listings l ON l.id = b.listing_id JOIN users u ON u.id = b.customer_id WHERE l.provider_id = ? ORDER BY b.created_at DESC`, [req.provider.id]);
  res.json({ bookings });
});

router.patch('/bookings/:id', requireProvider, (req, res) => {
  const booking = get(`SELECT b.* FROM bookings b JOIN listings l ON l.id = b.listing_id WHERE b.id = ? AND l.provider_id = ?`, [req.params.id, req.provider.id]);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  const status = String(req.body.status || '').toUpperCase();
  if (!['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  run(`UPDATE bookings SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [status, req.params.id]);
  res.json({ booking: get(`SELECT * FROM bookings WHERE id = ?`, [req.params.id]) });
});

router.get('/earnings', requireProvider, (req, res) => {
  const summary = get(`SELECT COALESCE(SUM(amount), 0) AS total, COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN amount ELSE 0 END), 0) AS paid, COUNT(*) AS count FROM bookings b JOIN listings l ON l.id = b.listing_id WHERE l.provider_id = ?`, [req.provider.id]);
  const bookings = all(`SELECT b.*, l.title AS listing_title FROM bookings b JOIN listings l ON l.id = b.listing_id WHERE l.provider_id = ? ORDER BY b.created_at DESC`, [req.provider.id]);
  res.json({ summary, bookings });
});

router.get('/vehicles', requireProvider, (req, res) => {
  const vehicles = all(`SELECT * FROM vehicles WHERE provider_id = ? ORDER BY created_at DESC`, [req.provider.id]);
  res.json({ vehicles });
});

router.post('/vehicles', requireProvider, (req, res) => {
  const { name, type, description, location, price_per_day, currency } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'Name and type are required' });
  const result = run(`INSERT INTO vehicles (provider_id, name, type, description, location, price_per_day, currency, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`, [req.provider.id, name, type, description || '', location || '', Number(price_per_day) || 0, currency || 'GHS']);
  res.status(201).json({ vehicle: get(`SELECT * FROM vehicles WHERE id = ?`, [result.lastInsertRowid]) });
});

const mediaStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(config.uploadDir, 'providers', String(req.provider.id), String(req.params.id));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${extension}`);
  }
});

const mediaUpload = multer({
  storage: mediaStorage,
  limits: { files: 8, fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
    if (!allowed.includes(file.mimetype)) return cb(new Error('Only JPG, PNG, WEBP, GIF, MP4, WEBM, MOV, and AVI files are allowed'));
    cb(null, true);
  }
});

router.post('/listings/:id/media', requireProvider, (req, res) => {
  const listing = get(`SELECT id FROM listings WHERE id = ? AND provider_id = ?`, [req.params.id, req.provider.id]);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });
  mediaUpload.array('media', 8)(req, res, (uploadError) => {
    if (uploadError) return res.status(400).json({ error: uploadError.message });
    if (!req.files || !req.files.length) return res.status(400).json({ error: 'At least one image or video is required' });
    try {
      const media = [];
      req.files.forEach((file, index) => {
        const mediaType = file.mimetype.startsWith('video/') ? 'video' : 'image';
        const result = run(`INSERT INTO listing_media (listing_id, file_path, media_type, mime_type, file_size, original_name, is_cover) VALUES (?, ?, ?, ?, ?, ?, ?)`, [listing.id, `/uploads/providers/${req.provider.id}/${listing.id}/${file.filename}`, mediaType, file.mimetype, file.size, file.originalname, index === 0 ? 1 : 0]);
        media.push(get(`SELECT * FROM listing_media WHERE id = ?`, [result.lastInsertRowid]));
      });
      res.status(201).json({ media });
    } catch (error) {
      req.files.forEach((file) => { try { fs.unlinkSync(file.path); } catch (_) {} });
      res.status(500).json({ error: 'Could not save uploaded media' });
    }
  });
});

router.get('/listings/:id/media', requireProvider, (req, res) => {
  const listing = get(`SELECT id FROM listings WHERE id = ? AND provider_id = ?`, [req.params.id, req.provider.id]);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });
  res.json({ media: all(`SELECT id, listing_id, file_path, media_type, mime_type, file_size, original_name, is_cover, created_at FROM listing_media WHERE listing_id = ? ORDER BY is_cover DESC, created_at ASC`, [listing.id]) });
});

router.delete('/listings/:listingId/media/:mediaId', requireProvider, (req, res) => {
  const media = get(`SELECT m.* FROM listing_media m JOIN listings l ON l.id = m.listing_id WHERE m.id = ? AND m.listing_id = ? AND l.provider_id = ?`, [req.params.mediaId, req.params.listingId, req.provider.id]);
  if (!media) return res.status(404).json({ error: 'Media not found' });
  const filePath = path.join(config.uploadDir, String(media.file_path || '').replace(/^\/uploads\//, ''));
  run(`DELETE FROM listing_media WHERE id = ?`, [media.id]);
  try { fs.unlinkSync(filePath); } catch (_) {}
  res.json({ ok: true });
});

module.exports = router;
