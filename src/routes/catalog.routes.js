'use strict';
/** Public catalog: search providers, drivers, delivery, hotels, short-stay, apartments. */
const express = require('express');
const { db } = require('../db');
const router = express.Router();

function listingWithPhotos(l) {
  const photos = db.prepare('SELECT file_path, is_cover FROM listing_photos WHERE listing_id = ? ORDER BY is_cover DESC').all(l.id);
  const provider = db.prepare(`SELECT p.id, p.user_id, p.provider_type, p.business_name, u.full_name, u.phone FROM providers p JOIN users u ON u.id = p.user_id WHERE p.id = ?`).get(l.provider_id);
  return { ...l, photos: photos.map(p => p.file_path), provider };
}

// GET /api/catalog — search with filters: category, city, q, min_price, max_price
router.get('/', (req, res) => {
  const { category, city, q, min_price, max_price } = req.query;
  const where = ["l.status = 'APPROVED'"];
  const params = [];
  if (category) { where.push('l.category = ?'); params.push(category); }
  if (city) { where.push('l.city = ?'); params.push(city); }
  if (q) { where.push('(l.title LIKE ? OR l.description LIKE ? OR l.location LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (min_price) { where.push('(l.price_per_night >= ? OR l.price_per_month >= ?)'); params.push(parseFloat(min_price), parseFloat(min_price)); }
  if (max_price) { where.push('(l.price_per_night <= ? OR l.price_per_month <= ?)'); params.push(parseFloat(max_price), parseFloat(max_price)); }
  const rows = db.prepare(`SELECT l.* FROM listings l WHERE ${where.join(' AND ')} ORDER BY l.is_featured DESC, l.created_at DESC LIMIT 100`).all(...params);
  res.json({ listings: rows.map(listingWithPhotos) });
});

// GET /api/catalog/providers — search providers by type
router.get('/providers', (req, res) => {
  const { type, q } = req.query;
  const where = ["p.status = 'APPROVED'"];
  const params = [];
  if (type) { where.push('p.provider_type = ?'); params.push(type); }
  if (q) { where.push('(p.business_name LIKE ? OR u.full_name LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  const rows = db.prepare(`SELECT p.id, p.provider_type, p.business_name, p.description, u.full_name, u.phone, u.identity_status
    FROM providers p JOIN users u ON u.id = p.user_id WHERE ${where.join(' AND ')} LIMIT 100`).all(...params);
  res.json({ providers: rows });
});

// GET /api/catalog/providers/:id — provider profile with listings
router.get('/providers/:id', (req, res) => {
  const p = db.prepare(`SELECT p.*, u.full_name, u.phone, u.email FROM providers p JOIN users u ON u.id = p.user_id WHERE p.id = ? AND p.status = 'APPROVED'`).get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Provider not found' });
  const listings = db.prepare(`SELECT * FROM listings WHERE provider_id = ? AND status = 'APPROVED'`).all(p.id).map(listingWithPhotos);
  const vehicles = db.prepare('SELECT * FROM vehicles WHERE provider_id = ?').all(p.id);
  const rating = db.prepare('SELECT AVG(rating) AS avg, COUNT(*) AS count FROM bookings WHERE provider_id = ? AND rating IS NOT NULL').get(p.id);
  res.json({ provider: p, listings, vehicles, rating });
});

// GET /api/catalog/listings/:id — single listing
router.get('/listings/:id', (req, res) => {
  const l = db.prepare('SELECT * FROM listings WHERE id = ? AND status = ?').get(req.params.id, 'APPROVED');
  if (!l) return res.status(404).json({ error: 'Listing not found' });
  const rooms = db.prepare('SELECT * FROM rooms WHERE listing_id = ? AND available = 1').all(l.id);
  res.json({ listing: listingWithPhotos(l), rooms });
});

// GET /api/catalog/categories
router.get('/categories', (req, res) => {
  res.json({ categories: ['ride', 'delivery', 'hotel', 'short_stay', 'apartment', 'property', 'other'] });
});

module.exports = router;