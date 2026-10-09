'use strict';
/** Bookings: rides, delivery, hotels, short-stay, apartments. */
const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const payments = require('../services/payments');
const { notify } = require('../services/notifications');
const { getSetting } = require('../services/subscriptions');
const router = express.Router();

function ref(prefix) { return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; }

function bookingView(b) {
  const customer = db.prepare('SELECT id, full_name, phone FROM users WHERE id = ?').get(b.customer_id);
  const provider = b.provider_id ? db.prepare('SELECT id, provider_type, business_name FROM providers WHERE id = ?').get(b.provider_id) : null;
  const listing = b.listing_id ? db.prepare('SELECT id, title, category FROM listings WHERE id = ?').get(b.listing_id) : null;
  return { ...b, customer, provider, listing };
}

function checkControl(key) {
  const c = db.prepare('SELECT value FROM platform_controls WHERE key = ?').get(key);
  return c && c.value === 'on';
}

// POST /api/bookings — create a booking (ride | delivery | hotel | short_stay | apartment | property)
router.post('/', requireAuth, async (req, res) => {
  if (checkControl('bookings')) return res.status(403).json({ error: 'Bookings are currently paused by the platform.' });
  const { category, listing_id, room_id, provider_id, pickup_location, destination, package_info, check_in, check_out, quantity, notes, amount } = req.body || {};
  if (!category) return res.status(400).json({ error: 'category is required' });

  // Module-level controls
  const moduleControl = { ride: 'transportation', delivery: 'delivery', hotel: 'hotels', short_stay: 'short_stay', apartment: 'property', property: 'property' }[category];
  if (moduleControl && checkControl(moduleControl)) return res.status(403).json({ error: `The ${category} module is currently disabled.` });

  let finalAmount = parseFloat(amount || 0);
  let finalProviderId = provider_id || null;
  let finalListingId = listing_id || null;
  let finalRoomId = room_id || null;

  if (category === 'hotel' || category === 'short_stay') {
    if (!listing_id || !check_in || !check_out) return res.status(400).json({ error: 'listing_id, check_in and check_out are required' });
    const listing = db.prepare('SELECT * FROM listings WHERE id = ? AND status = ?').get(listing_id, 'APPROVED');
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    finalProviderId = listing.provider_id;
    const nights = Math.max(1, Math.round((new Date(check_out) - new Date(check_in)) / 864e5));
    let price = listing.price_per_night;
    if (room_id) { const room = db.prepare('SELECT * FROM rooms WHERE id = ? AND listing_id = ?').get(room_id, listing_id); if (room) price = room.price_per_night; }
    finalAmount = price * nights;
  } else if (category === 'apartment' || category === 'property') {
    if (!listing_id) return res.status(400).json({ error: 'listing_id is required' });
    const listing = db.prepare('SELECT * FROM listings WHERE id = ? AND status = ?').get(listing_id, 'APPROVED');
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    finalProviderId = listing.provider_id;
    finalAmount = listing.price_per_month || parseFloat(amount || 0);
  } else if (category === 'ride') {
    if (!pickup_location || !destination) return res.status(400).json({ error: 'pickup_location and destination are required' });
    finalAmount = parseFloat(amount || 0); // estimated price where supported
  } else if (category === 'delivery') {
    if (!pickup_location || !destination) return res.status(400).json({ error: 'pickup_location and destination are required' });
    finalAmount = parseFloat(amount || 0);
  }

  const bookingRef = ref('BK');
  const info = db.prepare(`INSERT INTO bookings (booking_ref, customer_id, provider_id, listing_id, room_id, category, status, pickup_location, destination, package_info, check_in, check_out, quantity, amount, notes)
    VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(bookingRef, req.user.id, finalProviderId || null, finalListingId || null, finalRoomId || null, category,
      pickup_location || null, destination || null, package_info || null, check_in || null, check_out || null, quantity || 1, finalAmount, notes || null);
  const bookingId = info.lastInsertRowid;

  if (category === 'ride') {
    db.prepare('INSERT INTO ride_requests (booking_id, status) VALUES (?, ?)').run(bookingId, 'SEARCHING');
  } else if (category === 'delivery') {
    db.prepare('INSERT INTO delivery_orders (booking_id, status) VALUES (?, ?)').run(bookingId, 'PENDING');
  }

  if (finalProviderId) notify(db.prepare('SELECT user_id FROM providers WHERE id = ?').get(finalProviderId)?.user_id, 'booking', 'New booking request', `You have a new ${category} booking request.`);

  // Payment flow: if amount > 0 and payments configured, initialize payment; else booking stays PENDING until payment.
  let payment = null;
  if (finalAmount > 0) {
    const init = await awaitPay(req.user, bookingId, finalAmount, category);
    if (init && init.error) {
      // Honest state: booking created but payment NOT CONFIGURED — stays PENDING, no fake payment.
      payment = init;
    } else {
      payment = init;
    }
  } else {
    db.prepare(`UPDATE bookings SET status = 'CONFIRMED', updated_at = datetime('now') WHERE id = ?`).run(bookingId);
  }
  res.status(201).json({ booking: bookingView(db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId)), payment });
});

async function awaitPay(user, bookingId, amount, category) {
  const init = await payments.initializePayment({
    customerId: user.id, bookingId, type: 'booking_payment', amount, category,
    description: `Booking ${bookingId} — ${category}`, email: user.email
  });
  return init;
}

// GET /api/bookings/mine — customer's bookings
router.get('/mine', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM bookings WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100').all(req.user.id);
  res.json({ bookings: rows.map(bookingView) });
});

// GET /api/bookings/:id
router.get('/:id', requireAuth, (req, res) => {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  if (b.customer_id !== req.user.id) {
    const prov = db.prepare('SELECT * FROM providers WHERE user_id = ?').get(req.user.id);
    if (!prov || b.provider_id !== prov.id) return res.status(403).json({ error: 'Not your booking' });
  }
  res.json({ booking: bookingView(b) });
});

// POST /api/bookings/:id/cancel — customer cancellation per policy
router.post('/:id/cancel', requireAuth, (req, res) => {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  if (b.customer_id !== req.user.id) return res.status(403).json({ error: 'Not your booking' });
  if (['COMPLETED', 'CANCELLED'].includes(b.status)) return res.status(400).json({ error: `Booking is already ${b.status}` });
  const { reason } = req.body || {};
  db.prepare(`UPDATE bookings SET status = 'CANCELLED', cancellation_reason = ?, cancelled_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(reason || null, b.id);
  if (b.provider_id) notify(db.prepare('SELECT user_id FROM providers WHERE id = ?').get(b.provider_id)?.user_id, 'booking', 'Booking cancelled', `Booking ${b.booking_ref} was cancelled by the customer.`);
  res.json({ booking: bookingView(db.prepare('SELECT * FROM bookings WHERE id = ?').get(b.id)) });
});

// POST /api/bookings/:id/rate — rate and review
router.post('/:id/rate', requireAuth, (req, res) => {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  if (b.customer_id !== req.user.id) return res.status(403).json({ error: 'Not your booking' });
  if (b.status !== 'COMPLETED') return res.status(400).json({ error: 'Only completed bookings can be rated' });
  const { rating, review } = req.body || {};
  const r = parseInt(rating, 10);
  if (!r || r < 1 || r > 5) return res.status(400).json({ error: 'rating must be 1-5' });
  db.prepare(`UPDATE bookings SET rating = ?, review = ?, updated_at = datetime('now') WHERE id = ?`).run(r, review || null, b.id);
  res.json({ ok: true });
});

module.exports = router;
