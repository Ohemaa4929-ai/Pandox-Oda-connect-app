'use strict';
/* Extended e2e — exercises the full API surface the smoke test doesn't cover. */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 3998;
const BASE = `http://localhost:${PORT}`;
const TEST_DB = path.join(__dirname, '..', 'data', 'test-e2e.db');
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
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} ${extra}`); }
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
  check('Server boots', up);
  if (!up) { console.log(serverLog); process.exit(1); }

  // Customer + provider registration
  const cust = await req('POST', '/api/auth/register', { email: 'ama2@example.com', password: 'Password123!', full_name: 'Ama Serwaa', phone: '0244000011' });
  check('Customer registers', cust.status === 201);
  const custToken = cust.data.token;

  const prov = await req('POST', '/api/auth/register', { email: 'kofi2@example.com', password: 'Password123!', full_name: 'Kofi Mensah', phone: '0244000012', role: 'provider', provider_type: 'driver', business_name: 'Kofi Rides', identity_type: 'ghana_card', identity_number: 'GHA-123456789-0' });
  check('Provider registers', prov.status === 201);
  const provToken = prov.data.token;
  const provUserId = prov.data.user.id;

  // Admin login
  const adminLogin = await req('POST', '/api/admin/auth/login', { email: 'owner@pandoxoda.com', password: 'OwnerPass123!' });
  check('Admin login', adminLogin.status === 200 && adminLogin.data.token);
  const adminToken = adminLogin.data.token;

  // Approve identity + provider
  const idApprove = await req('POST', `/api/admin/verifications/${provUserId}/review`, { action: 'APPROVED' }, adminToken);
  check('Admin approves identity', idApprove.status === 200);
  const provApprove = await req('POST', '/api/admin/providers/1/verify', { action: 'APPROVED' }, adminToken);
  check('Admin approves provider', provApprove.status === 200);

  // Provider profile + vehicle + listing
  const pme = await req('GET', '/api/provider/me', null, provToken);
  check('Provider /me', pme.status === 200 && pme.data.provider.status === 'APPROVED');
  const veh = await req('POST', '/api/provider/vehicles', { make: 'Toyota', model: 'Corolla', plate_number: 'AK-1234-24', vehicle_type: 'car', seats: 4 }, provToken);
  check('Provider adds vehicle', veh.status === 201);
  const vehList = await req('GET', '/api/provider/vehicles', null, provToken);
  check('Provider lists vehicles', vehList.status === 200 && vehList.data.vehicles.length === 1);
  const listing = await req('POST', '/api/provider/listings', { category: 'hotel', title: 'Oda Comfort Hotel', description: 'Central hotel', location: 'Akim Oda Main St', price_per_night: 250 }, provToken);
  check('Provider creates listing', listing.status === 201);
  const listingId = listing.data.listing.id;
  const listApprove = await req('POST', `/api/admin/listings/${listingId}/status`, { status: 'APPROVED' }, adminToken);
  check('Admin approves listing', listApprove.status === 200);

  // Catalog
  const catalog = await req('GET', '/api/catalog?category=hotel');
  check('Catalog shows listing', catalog.status === 200 && catalog.data.listings.some(l => l.id === listingId));
  const catProv = await req('GET', '/api/catalog/providers?type=driver');
  check('Catalog providers', catProv.status === 200 && catProv.data.providers.length >= 1);
  const catListing = await req('GET', `/api/catalog/listings/${listingId}`);
  check('Catalog single listing', catListing.status === 200 && catListing.data.listing.id === listingId);
  const catCats = await req('GET', '/api/catalog/categories');
  check('Catalog categories', catCats.status === 200 && catCats.data.categories.includes('hotel'));

  // Bookings: hotel + ride + delivery
  const bookHotel = await req('POST', '/api/bookings', { category: 'hotel', listing_id: listingId, check_in: '2026-10-20', check_out: '2026-10-22' }, custToken);
  check('Hotel booking', bookHotel.status === 201 && bookHotel.data.booking.amount === 500);
  const bookRide = await req('POST', '/api/bookings', { category: 'ride', pickup_location: 'A', destination: 'B', amount: 20 }, custToken);
  check('Ride booking', bookRide.status === 201);
  const rideId = bookRide.data.booking.id;
  const bookDel = await req('POST', '/api/bookings', { category: 'delivery', pickup_location: 'X', destination: 'Y', package_info: 'Box', amount: 15 }, custToken);
  check('Delivery booking', bookDel.status === 201);
  const delId = bookDel.data.booking.id;

  // Provider accepts ride + delivery
  const accRide = await req('POST', `/api/provider/bookings/${rideId}/accept`, {}, provToken);
  check('Provider accepts ride', accRide.status === 200);
  const accDel = await req('POST', `/api/provider/bookings/${delId}/accept`, {}, provToken);
  check('Provider accepts delivery', accDel.status === 200);
  const delStatus = await req('POST', `/api/provider/bookings/${delId}/status`, { status: 'COMPLETED' }, provToken);
  check('Provider completes delivery', delStatus.status === 200);

  // Provider earnings
  const earnings = await req('GET', '/api/provider/earnings', null, provToken);
  check('Provider earnings', earnings.status === 200 && typeof earnings.data.total_provider_amount === 'number');

  // User profile, notifications, bookings, transactions
  const profile = await req('GET', '/api/user/profile', null, custToken);
  check('User profile', profile.status === 200 && profile.data.user.email === 'ama2@example.com');
  const profUpd = await req('PUT', '/api/user/profile', { full_name: 'Ama Serwaa II' }, custToken);
  check('User profile update', profUpd.status === 200);
  const notifs = await req('GET', '/api/user/notifications', null, custToken);
  check('User notifications', notifs.status === 200 && notifs.data.notifications.length >= 1);
  const myBookings = await req('GET', '/api/user/bookings', null, custToken);
  check('User bookings', myBookings.status === 200 && myBookings.data.bookings.length >= 3);
  const myTxns = await req('GET', '/api/user/transactions', null, custToken);
  check('User transactions', myTxns.status === 200);

  // Bookings mine + cancel + rate
  const mine = await req('GET', '/api/bookings/mine', null, custToken);
  check('Bookings mine', mine.status === 200 && mine.data.bookings.length >= 3);
  const cancel = await req('POST', `/api/bookings/${rideId}/cancel`, { reason: 'Changed my mind' }, custToken);
  check('Booking cancel', cancel.status === 200 && cancel.data.booking.status === 'CANCELLED');
  const rate = await req('POST', `/api/bookings/${delId}/rate`, { rating: 5, review: 'Great service' }, custToken);
  check('Booking rate', rate.status === 200);

  // Disputes
  const dispute = await req('POST', '/api/disputes', { category: 'booking', booking_id: bookHotel.data.booking.id, description: 'Not as described' }, custToken);
  check('Dispute opened', dispute.status === 201);
  const disputeId = dispute.data.dispute.id;
  const mineDisp = await req('GET', '/api/disputes/mine', null, custToken);
  check('Disputes mine', mineDisp.status === 200 && mineDisp.data.disputes.length >= 1);
  const dispNote = await req('POST', `/api/disputes/${disputeId}/notes`, { note: 'More detail' }, custToken);
  check('Dispute note', dispNote.status === 201);
  const dispDetail = await req('GET', `/api/disputes/${disputeId}`, null, custToken);
  check('Dispute detail', dispDetail.status === 200 && dispDetail.data.notes.length >= 1);

  // Subscriptions
  const subMe = await req('GET', '/api/payments/subscriptions/me', null, custToken);
  check('Subscription /me', subMe.status === 200 && subMe.data.customer_plan);
  const sub = await req('POST', '/api/payments/subscriptions/subscribe', { audience: 'customer' }, custToken);
  check('Subscribe (free plan activates)', sub.status === 200 && (sub.data.activated === true || sub.data.subscription_id));

  // Payments NOT CONFIGURED
  const payInit = await req('POST', '/api/payments/initialize', { type: 'booking_payment', amount: 100, booking_id: bookHotel.data.booking.id }, custToken);
  check('Payment init NOT CONFIGURED', payInit.status === 400 && payInit.data.error === 'NOT CONFIGURED');
  const payVerify = await req('POST', '/api/payments/verify', { reference: 'TXN-XYZ' }, custToken);
  check('Payment verify NOT CONFIGURED', payVerify.status === 400 && payVerify.data.error === 'NOT CONFIGURED');
  const webhook = await req('POST', '/api/payments/webhook/paystack', { event: 'charge.success', data: { reference: 'X' } });
  check('Webhook ignored when unconfigured', webhook.status === 200);

  // Admin: users, providers, verifications, listings, bookings, disputes, transactions, refunds, subscriptions, commissions, controls, settings, policies, campaigns, staff, sessions, audit, reports
  const users = await req('GET', '/api/admin/users', null, adminToken);
  check('Admin users', users.status === 200 && users.data.users.length >= 2);
  const providers = await req('GET', '/api/admin/providers', null, adminToken);
  check('Admin providers', providers.status === 200 && providers.data.providers.length >= 1);
  const verifs = await req('GET', '/api/admin/verifications', null, adminToken);
  check('Admin verifications', verifs.status === 200);
  const listings = await req('GET', '/api/admin/listings', null, adminToken);
  check('Admin listings', listings.status === 200 && listings.data.listings.length >= 1);
  const bookings = await req('GET', '/api/admin/bookings', null, adminToken);
  check('Admin bookings', bookings.status === 200 && bookings.data.bookings.length >= 3);
  const disputes = await req('GET', '/api/admin/disputes', null, adminToken);
  check('Admin disputes', disputes.status === 200 && disputes.data.disputes.length >= 1);
  const transactions = await req('GET', '/api/admin/transactions', null, adminToken);
  check('Admin transactions', transactions.status === 200);
  const refunds = await req('GET', '/api/admin/refunds', null, adminToken);
  check('Admin refunds', refunds.status === 200);
  const subscriptions = await req('GET', '/api/admin/subscriptions', null, adminToken);
  check('Admin subscriptions', subscriptions.status === 200);
  const plans = await req('GET', '/api/admin/subscription-plans', null, adminToken);
  check('Admin plans', plans.status === 200 && plans.data.plans.length >= 2);
  const commissions = await req('GET', '/api/admin/commissions', null, adminToken);
  check('Admin commissions', commissions.status === 200 && commissions.data.commissions.length >= 5);
  const controls = await req('GET', '/api/admin/controls', null, adminToken);
  check('Admin controls', controls.status === 200 && controls.data.controls.bookings === 'off');
  const settings = await req('GET', '/api/admin/settings', null, adminToken);
  check('Admin settings', settings.status === 200 && settings.data.settings.platform_name === 'PANDOX ODA CONNECT');
  const policies = await req('GET', '/api/admin/policies', null, adminToken);
  check('Admin policies', policies.status === 200 && policies.data.policies.length >= 10);
  const campaigns = await req('GET', '/api/admin/campaigns', null, adminToken);
  check('Admin campaigns', campaigns.status === 200);
  const staff = await req('GET', '/api/admin/staff', null, adminToken);
  check('Admin staff', staff.status === 200 && staff.data.staff.length >= 1);
  const sessions = await req('GET', '/api/admin/sessions', null, adminToken);
  check('Admin sessions', sessions.status === 200 && sessions.data.sessions.length >= 1);
  const audit = await req('GET', '/api/admin/audit-logs', null, adminToken);
  check('Admin audit logs', audit.status === 200 && audit.data.logs.length >= 1);
  const reports = await req('GET', '/api/admin/reports?period=month', null, adminToken);
  check('Admin reports', reports.status === 200 && Array.isArray(reports.data.revenue));

  // Admin writes
  const userSuspend = await req('POST', '/api/admin/users/2/status', { status: 'SUSPENDED' }, adminToken);
  check('Admin suspends user', userSuspend.status === 200);
  const userReact = await req('POST', '/api/admin/users/2/status', { status: 'ACTIVE' }, adminToken);
  check('Admin reactivates user', userReact.status === 200);
  const provSuspend = await req('POST', '/api/admin/providers/1/status', { status: 'SUSPENDED' }, adminToken);
  check('Admin suspends provider', provSuspend.status === 200);
  const provReact = await req('POST', '/api/admin/providers/1/status', { status: 'APPROVED' }, adminToken);
  check('Admin reactivates provider', provReact.status === 200);
  const listSuspend = await req('POST', `/api/admin/listings/${listingId}/status`, { status: 'SUSPENDED' }, adminToken);
  check('Admin suspends listing', listSuspend.status === 200);
  const listRestore = await req('POST', `/api/admin/listings/${listingId}/status`, { status: 'APPROVED' }, adminToken);
  check('Admin restores listing', listRestore.status === 200);
  const bookCancel = await req('POST', `/api/admin/bookings/${bookHotel.data.booking.id}/cancel`, { reason: 'Platform' }, adminToken);
  check('Admin cancels booking', bookCancel.status === 200);
  const dispResolve = await req('POST', `/api/admin/disputes/${disputeId}/status`, { status: 'RESOLVED', resolution: 'Refund issued' }, adminToken);
  check('Admin resolves dispute', dispResolve.status === 200);
  const planUpd = await req('PUT', '/api/admin/subscription-plans/1', { price: 20, billing_period_days: 30, trial_days: 7 }, adminToken);
  check('Admin updates plan', planUpd.status === 200);
  const commUpd = await req('PUT', '/api/admin/commissions/hotel', { percent: 8, fixed_fee: 0 }, adminToken);
  check('Admin updates commission', commUpd.status === 200);
  const ctrlOn = await req('POST', '/api/admin/controls', { key: 'bookings', value: 'on' }, adminToken);
  check('Admin pauses bookings', ctrlOn.status === 200);
  const blocked = await req('POST', '/api/bookings', { category: 'ride', pickup_location: 'A', destination: 'B', amount: 20 }, custToken);
  check('Bookings paused blocks new', blocked.status === 403);
  const ctrlOff = await req('POST', '/api/admin/controls', { key: 'bookings', value: 'off' }, adminToken);
  check('Admin unpauses bookings', ctrlOff.status === 200);
  const settingsUpd = await req('PUT', '/api/admin/settings', { platform_name: 'PANDOX ODA CONNECT', support_email: 'help@pandoxoda.com' }, adminToken);
  check('Admin updates settings', settingsUpd.status === 200);
  const policyUpd = await req('PUT', '/api/admin/policies/1', { content: 'Updated terms v2' }, adminToken);
  check('Admin updates policy', policyUpd.status === 200);
  const campaign = await req('POST', '/api/admin/campaigns', { title: 'Welcome', body: 'Welcome to PANDOX', audience: 'all' }, adminToken);
  check('Admin creates campaign', campaign.status === 201);
  const campSend = await req('POST', `/api/admin/campaigns/${campaign.data.campaign.id}/send`, {}, adminToken);
  check('Admin sends campaign', campSend.status === 200 && campSend.data.sent >= 1);
  const staffCreate = await req('POST', '/api/admin/staff', { full_name: 'Finance Officer', email: 'finance2@pandoxoda.com', password: 'FinancePass123!', role: 'FINANCE_ADMIN' }, adminToken);
  check('Admin creates staff', staffCreate.status === 201);
  const sessionRevoke = await req('POST', '/api/admin/sessions/revoke', { session_id: sessions.data.sessions[0].id }, adminToken);
  check('Admin revokes session', sessionRevoke.status === 200);
  const expiry = await req('POST', '/api/admin/maintenance/expiry-checks', {}, adminToken);
  check('Admin expiry checks', expiry.status === 200);

  // RBAC: customer blocked from admin
  const rbac = await req('GET', '/api/admin/users', null, custToken);
  check('Customer blocked from admin', rbac.status === 401 || rbac.status === 403);

  // Policies public + accept
  const pubPolicies = await req('GET', '/api/user/policies');
  check('Public policies', pubPolicies.status === 200 && pubPolicies.data.policies.length >= 10);
  const accept = await req('POST', '/api/user/policies/accept', { policy_id: pubPolicies.data.policies[0].id }, custToken);
  check('Policy accept', accept.status === 200);
  const accepted = await req('GET', '/api/user/policies/accepted', null, custToken);
  check('Policy accepted list', accepted.status === 200 && accepted.data.accepted.length >= 1);
  const policyDetail = await req('GET', `/api/user/policies/${pubPolicies.data.policies[0].slug}`);
  check('Policy detail', policyDetail.status === 200 && policyDetail.data.policy.content);

  // 2FA customer
  const tfa = await req('POST', '/api/auth/me/2fa/setup', {}, custToken);
  check('Customer 2FA setup', tfa.status === 200 && tfa.data.secret && tfa.data.otpauth_url);

  // Static frontends
  const appHtml = await fetch(BASE + '/');
  const appText = await appHtml.text();
  check('Customer app served', appHtml.status === 200 && appText.includes('PANDOX'));
  const adminHtml = await fetch(BASE + '/admin/');
  const adminText = await adminHtml.text();
  check('Owner dashboard served', adminHtml.status === 200 && adminText.includes('Owner Dashboard'));

  console.log(`\n=== EXTENDED E2E — ${passed} passed, ${failed} failed ===`);
  server.kill();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('E2E harness error:', e); console.log(serverLog); server.kill(); process.exit(1); });
