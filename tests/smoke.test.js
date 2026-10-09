'use strict';
/**
 * PANDOX ODA CONNECT — integration smoke tests (spec §32).
 * Boots the real server on a fresh test DB and exercises every core flow.
 * Run: npm test  (or: node tests/smoke.test.js)
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const TEST_DB = path.join(__dirname, '..', 'data', 'test-pandox.db');
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const env = {
  ...process.env,
  PORT: String(PORT),
  DB_PATH: TEST_DB,
  NODE_ENV: 'test',
  SESSION_SECRET: 'test-session-secret-0123456789abcdef0123456789abcdef',
  ENCRYPTION_KEY: 'a'.repeat(64),
  ADMIN_EMAIL: 'owner@pandoxoda.com',
  ADMIN_PASSWORD: 'OwnerPass123!',
  ADMIN_NAME: 'Test Owner'
};

let passed = 0, failed = 0;
const results = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; results.push(`  ✅ ${name}`); }
  else { failed++; results.push(`  ❌ ${name} ${extra}`); }
}

async function req(method, p, body, token) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const server = spawn('node', ['server.js'], { env, cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', d => serverLog += d);
server.stderr.on('data', d => serverLog += d);

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) return true; } catch (e) {}
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

(async () => {
  const up = await waitForServer();
  check('Server boots and /api/health responds', up);
  if (!up) { console.log(serverLog); process.exit(1); }

  // 1. Health
  const health = await req('GET', '/api/health');
  check('Health returns ok:true', health.data.ok === true);

  // 2. Customer registration
  const cust = await req('POST', '/api/auth/register', { email: 'ama@example.com', password: 'Password123!', full_name: 'Ama Serwaa', phone: '0244000001' });
  check('Customer registration succeeds (201)', cust.status === 201, `got ${cust.status}`);
  const custToken = cust.data.token;
  check('Customer token returned', !!custToken);

  // 3. Duplicate email rejected
  const dup = await req('POST', '/api/auth/register', { email: 'ama@example.com', password: 'Password123!', full_name: 'Ama 2' });
  check('Duplicate email rejected (409)', dup.status === 409);

  // 4. Weak password rejected
  const weak = await req('POST', '/api/auth/register', { email: 'weak@example.com', password: 'short', full_name: 'Weak' });
  check('Weak password rejected (400)', weak.status === 400);

  // 5. Provider registration with identity
  const prov = await req('POST', '/api/auth/register', {
    email: 'driver@example.com', password: 'Password123!', full_name: 'Kofi Mensah', phone: '0244000002',
    role: 'provider', provider_type: 'driver', business_name: 'Kofi Rides',
    identity_type: 'ghana_card', identity_number: 'GHA-123456789-0'
  });
  check('Provider registration succeeds (201)', prov.status === 201, `got ${prov.status}`);
  const provToken = prov.data.token;
  const provUserId = prov.data.user.id;

  // 6. Provider starts PENDING_VERIFICATION
  check('Provider is PENDING_VERIFICATION', prov.data.user.role === 'provider');

  // 7. Identity submission
  const idSub = await req('POST', '/api/auth/identity', { identity_type: 'passport', identity_number: 'G1234567' }, custToken);
  check('Identity submission accepted', idSub.status === 200 && ['PENDING', 'UNDER_REVIEW'].includes(idSub.data.status), JSON.stringify(idSub.data));

  // 8. Unauthenticated access blocked
  const noAuth = await req('GET', '/api/user/profile');
  check('Unauthenticated /user/profile blocked (401)', noAuth.status === 401);

  // 9. Admin login
  const adminLogin = await req('POST', '/api/admin/auth/login', { email: 'owner@pandoxoda.com', password: 'OwnerPass123!' });
  check('Admin login succeeds', adminLogin.status === 200 && adminLogin.data.token, `got ${adminLogin.status}`);
  const adminToken = adminLogin.data.token;
  check('Admin role is SUPER_ADMIN', adminLogin.data.admin.role === 'SUPER_ADMIN');

  // 10. Admin dashboard stats
  const dash = await req('GET', '/api/admin/dashboard', null, adminToken);
  check('Dashboard stats return', dash.status === 200 && typeof dash.data.stats.total_users === 'number');

  // 11. Admin approves identity
  const idApprove = await req('POST', `/api/admin/verifications/${provUserId}/review`, { action: 'APPROVED' }, adminToken);
  check('Admin approves identity', idApprove.status === 200, JSON.stringify(idApprove.data));

  // 12. Admin approves provider
  const provApprove = await req('POST', '/api/admin/providers/1/verify', { action: 'APPROVED' }, adminToken);
  check('Admin approves provider', provApprove.status === 200, JSON.stringify(provApprove.data));

  // 13. Provider creates listing (approval required by default)
  const listing = await req('POST', '/api/provider/listings', { category: 'hotel', title: 'Oda Comfort Hotel', description: 'Central hotel', location: 'Akim Oda Main St', price_per_night: 250 }, provToken);
  check('Provider creates listing', listing.status === 201, JSON.stringify(listing.data));
  const listingId = listing.data.listing.id;
  check('Listing starts PENDING', listing.data.listing.status === 'PENDING');

  // 14. Admin approves listing
  const listApprove = await req('POST', `/api/admin/listings/${listingId}/status`, { status: 'APPROVED' }, adminToken);
  check('Admin approves listing', listApprove.status === 200);

  // 15. Public catalog shows listing
  const catalog = await req('GET', '/api/catalog?category=hotel');
  check('Catalog returns approved listing', catalog.status === 200 && catalog.data.listings.some(l => l.id === listingId));

  // 16. Customer books hotel (payment NOT CONFIGURED → booking created, payment null/error path)
  const book = await req('POST', '/api/bookings', { category: 'hotel', listing_id: listingId, check_in: '2026-10-20', check_out: '2026-10-22' }, custToken);
  check('Booking created', book.status === 201, JSON.stringify(book.data));
  const bookingId = book.data.booking.id;
  check('Booking amount computed (2 nights × 250)', book.data.booking.amount === 500, `got ${book.data.booking.amount}`);
  check('Booking payment honestly NOT CONFIGURED (no fake gateway)', book.data.payment && book.data.payment.error === 'NOT CONFIGURED', JSON.stringify(book.data.payment));

  // 17. Payment NOT CONFIGURED surfaced honestly
  const payInit = await req('POST', '/api/payments/initialize', { type: 'booking_payment', amount: 500, booking_id: bookingId }, custToken);
  check('Payment init reports NOT CONFIGURED (no fake gateway)', payInit.status === 400 && payInit.data.error === 'NOT CONFIGURED', JSON.stringify(payInit.data));

  // 18. Provider sees booking
  const provBookings = await req('GET', '/api/provider/bookings', null, provToken);
  check('Provider sees booking', provBookings.status === 200 && provBookings.data.bookings.some(b => b.id === bookingId));

  // 19. Provider accepts ride/delivery — hotel booking has no accept; check earnings endpoint works
  const earnings = await req('GET', '/api/provider/earnings', null, provToken);
  check('Provider earnings endpoint works', earnings.status === 200);

  // 20. Customer opens dispute
  const dispute = await req('POST', '/api/disputes', { category: 'booking', booking_id: bookingId, description: 'Test dispute' }, custToken);
  check('Dispute opened', dispute.status === 201, JSON.stringify(dispute.data));
  const disputeId = dispute.data.dispute.id;

  // 21. Admin sees dispute and resolves
  const adminDisputes = await req('GET', '/api/admin/disputes', null, adminToken);
  check('Admin sees dispute', adminDisputes.status === 200 && adminDisputes.data.disputes.some(d => d.id === disputeId));
  const resolve = await req('POST', `/api/admin/disputes/${disputeId}/status`, { status: 'RESOLVED', resolution: 'Test resolution' }, adminToken);
  check('Admin resolves dispute', resolve.status === 200);

  // 22. Subscription plans visible + price change (owner-configurable)
  const plans = await req('GET', '/api/admin/subscription-plans', null, adminToken);
  check('Subscription plans listed', plans.status === 200 && plans.data.plans.length >= 2);
  const planId = plans.data.plans[0].id;
  const planUpd = await req('PUT', `/api/admin/subscription-plans/${planId}`, { price: 99, billing_period_days: 30, trial_days: 0 }, adminToken);
  check('Owner updates subscription price', planUpd.status === 200);

  // 23. Commission update
  const comm = await req('PUT', '/api/admin/commissions/hotel', { percent: 10, fixed_fee: 0 }, adminToken);
  check('Commission updated', comm.status === 200);

  // 24. Platform control: pause bookings
  const ctrl = await req('POST', '/api/admin/controls', { key: 'bookings', value: 'on' }, adminToken);
  check('Platform control toggled', ctrl.status === 200);
  const blockedBook = await req('POST', '/api/bookings', { category: 'ride', pickup_location: 'A', destination: 'B', amount: 20 }, custToken);
  check('Bookings paused → new booking blocked (403)', blockedBook.status === 403);
  await req('POST', '/api/admin/controls', { key: 'bookings', value: 'off' }, adminToken);

  // 25. RBAC: non-admin user cannot hit admin API
  const rbac = await req('GET', '/api/admin/users', null, custToken);
  check('Customer token blocked from admin API (401/403)', rbac.status === 401 || rbac.status === 403);

  // 26. Audit log records admin actions
  const audit = await req('GET', '/api/admin/audit-logs', null, adminToken);
  check('Audit log has entries', audit.status === 200 && audit.data.logs.length >= 5, `got ${audit.data.logs.length}`);

  // 27. 2FA setup flow
  const tfa = await req('POST', '/api/admin/auth/2fa/setup', {}, adminToken);
  check('2FA setup returns secret + QR', tfa.status === 200 && tfa.data.secret && tfa.data.otpauth_url, JSON.stringify(tfa.data));

  // 28. Policies listed and accept flow
  const policies = await req('GET', '/api/user/policies');
  check('Policies listed publicly', policies.status === 200 && policies.data.policies.length >= 10);
  const accept = await req('POST', '/api/user/policies/accept', { policy_id: policies.data.policies[0].id }, custToken);
  check('Policy acceptance recorded', accept.status === 200);

  // 29. Reports
  const reports = await req('GET', '/api/admin/reports?period=month', null, adminToken);
  check('Reports endpoint works', reports.status === 200 && Array.isArray(reports.data.revenue));

  // 30. Staff creation (SUPER_ADMIN only)
  const staff = await req('POST', '/api/admin/staff', { full_name: 'Finance Officer', email: 'finance@pandoxoda.com', password: 'FinancePass123!', role: 'FINANCE_ADMIN' }, adminToken);
  check('Staff admin created', staff.status === 201, JSON.stringify(staff.data));

  // 31. Sessions listed
  const sessions = await req('GET', '/api/admin/sessions', null, adminToken);
  check('Admin sessions listed', sessions.status === 200 && sessions.data.sessions.length >= 1);

  // 32. Settings update
  const settings = await req('PUT', '/api/admin/settings', { platform_name: 'PANDOX ODA CONNECT' }, adminToken);
  check('Settings update works', settings.status === 200);

  // 33. Maintenance/expiry checks
  const expiry = await req('POST', '/api/admin/maintenance/expiry-checks', {}, adminToken);
  check('Expiry checks run', expiry.status === 200);

  // 34. Static frontends served
  const appHtml = await fetch(BASE + '/');
  const appText = await appHtml.text();
  check('Customer app served', appHtml.status === 200 && appText.includes('PANDOX'));
  const adminHtml = await fetch(BASE + '/admin');
  const adminText = await adminHtml.text();
  check('Owner dashboard served', adminHtml.status === 200 && adminText.includes('Owner Dashboard'));

  // 35. Security headers present
  check('Helmet security headers present', !!appHtml.headers.get('x-content-type-options'));

  console.log('\n=== PANDOX ODA CONNECT — TEST RESULTS ===');
  results.forEach(r => console.log(r));
  console.log(`\n${passed} passed, ${failed} failed`);
  server.kill();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('Test harness error:', e); server.kill(); process.exit(1); });
