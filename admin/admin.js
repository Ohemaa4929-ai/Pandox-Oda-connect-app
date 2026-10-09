'use strict';
/* PANDOX ODA CONNECT — Owner Dashboard (separate secure admin interface) */
const API = '/api/admin';
const state = { admin: null, token: localStorage.getItem('pandox_admin_token'), view: 'dashboard' };

const $ = (s) => document.querySelector(s);
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h !== undefined) e.innerHTML = h; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtGHS = (n) => `GH₵ ${Number(n || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fmtDT = (d) => d ? new Date(d).toLocaleString('en-GH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const toast = (m) => { const t = el('div', 'toast', esc(m)); t.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#0f172a;color:#fff;padding:12px 20px;border-radius:10px;z-index:200;font-size:14px'; document.body.appendChild(t); setTimeout(() => t.remove(), 3500); };

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  const res = await fetch(API + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { state.token = null; localStorage.removeItem('pandox_admin_token'); state.admin = null; render(); throw new Error('Session expired'); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const BADGE = { APPROVED: 'green', ACTIVE: 'green', COMPLETED: 'green', PAID: 'green', SUCCESSFUL: 'green', RESOLVED: 'green', PROCESSED: 'green', SETTLED: 'green',
  PENDING: 'amber', PENDING_VERIFICATION: 'amber', UNDER_REVIEW: 'amber', REQUESTED: 'amber', IN_PROGRESS: 'blue', CONFIRMED: 'blue', OPEN: 'blue', DRAFT: 'gray',
  REJECTED: 'red', SUSPENDED: 'red', CANCELLED: 'red', FAILED: 'red', EXPIRED: 'red', CLOSED: 'gray', DEACTIVATED: 'gray' };
const badge = (s) => `<span class="badge ${BADGE[s] || 'gray'}">${esc(s)}</span>`;

const MENU = [
  { section: 'Overview' },
  { v: 'dashboard', label: '📊 Dashboard' },
  { v: 'reports', label: '📈 Reports' },
  { section: 'Management' },
  { v: 'users', label: '👥 Users' },
  { v: 'providers', label: '🏪 Providers' },
  { v: 'verifications', label: '🪪 ID Verification' },
  { v: 'listings', label: '🏷️ Listings' },
  { v: 'bookings', label: '📅 Bookings' },
  { v: 'disputes', label: '⚖️ Disputes' },
  { section: 'Finance' },
  { v: 'transactions', label: '💳 Payments' },
  { v: 'refunds', label: '↩️ Refunds' },
  { v: 'subscriptions', label: '🔁 Subscriptions' },
  { v: 'commissions', label: '🧮 Commissions' },
  { section: 'Platform' },
  { v: 'chat', label: '💬 Messages' },
  { v: 'controls', label: '🛑 Control Center' },
  { v: 'settings', label: '⚙️ Settings' },
  { v: 'policies', label: '📜 Policies' },
  { v: 'campaigns', label: '📣 Notifications' },
  { v: 'staff', label: '🛡️ Admin Staff' },
  { v: 'audit', label: '📋 Audit Log' },
  { v: 'sessions', label: '🔐 Sessions' }
];

function sidebar() {
  const s = el('aside', 'sidebar');
  s.appendChild(el('div', 'logo', '<span class="dot">◆</span> PANDOX ODA<br>OWNER DASHBOARD'));
  MENU.forEach(m => {
    if (m.section) { s.appendChild(el('div', 'section', esc(m.section))); return; }
    const a = el('a', state.view === m.v ? 'active' : '', esc(m.label));
    a.href = '#'; a.onclick = (e) => { e.preventDefault(); go(m.v); };
    s.appendChild(a);
  });
  return s;
}

function topbar(title) {
  const t = el('div', 'topbar');
  const menu = el('button', 'mobile-menu', '☰ Menu');
  menu.type = 'button';
  menu.setAttribute('aria-label', 'Open dashboard navigation');
  menu.onclick = () => document.querySelector('.sidebar')?.classList.toggle('open');
  t.appendChild(menu);
  t.appendChild(el('h1', '', esc(title)));
  const a = el('div', 'admin');
  a.appendChild(el('span', '', esc(state.admin?.full_name || state.admin?.email || '')));
  a.appendChild(el('span', 'badge blue', esc(state.admin?.role || '')));
  const out = el('button', 'btn sm secondary', 'Logout');
  out.onclick = async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); state.token = null; localStorage.removeItem('pandox_admin_token'); state.admin = null; render(); };
  a.appendChild(out);
  t.appendChild(a);
  return t;
}

function go(v) { state.view = v; render(); }

async function render() {
  const app = $('#app');
  app.innerHTML = '';
  if (!state.admin) { app.appendChild(loginView()); return; }
  const layout = el('div', 'layout');
  layout.appendChild(sidebar());
  const main = el('div', 'main');
  const view = state.view;
  const titles = { dashboard: 'Dashboard', reports: 'Reports', users: 'Users', providers: 'Providers', verifications: 'ID Verification', listings: 'Listings', bookings: 'Bookings', disputes: 'Disputes', transactions: 'Payments & Transactions', refunds: 'Refunds', subscriptions: 'Subscriptions', commissions: 'Commissions', chat: 'Messages', controls: 'Platform Control Center', settings: 'Platform Settings', policies: 'Policies', campaigns: 'Notifications', staff: 'Admin Staff', audit: 'Audit Log', sessions: 'Sessions' };
  main.appendChild(topbar(titles[view] || view));
  try {
    if (view === 'dashboard') main.appendChild(await dashboardView());
    else if (view === 'reports') main.appendChild(await reportsView());
    else if (view === 'users') main.appendChild(await usersView());
    else if (view === 'providers') main.appendChild(await providersView());
    else if (view === 'verifications') main.appendChild(await verificationsView());
    else if (view === 'listings') main.appendChild(await listingsView());
    else if (view === 'bookings') main.appendChild(await bookingsView());
    else if (view === 'disputes') main.appendChild(await disputesView());
    else if (view === 'transactions') main.appendChild(await transactionsView());
    else if (view === 'refunds') main.appendChild(await refundsView());
    else if (view === 'subscriptions') main.appendChild(await subscriptionsView());
    else if (view === 'commissions') main.appendChild(await commissionsView());
    else if (view === 'controls') main.appendChild(await controlsView());
    else if (view === 'settings') main.appendChild(await settingsView());
    else if (view === 'policies') main.appendChild(await policiesView());
    else if (view === 'campaigns') main.appendChild(await campaignsView());
    else if (view === 'staff') main.appendChild(await staffView());
    else if (view === 'audit') main.appendChild(await auditView());
    else if (view === 'sessions') main.appendChild(await sessionsView());
    else if (view === 'chat') main.appendChild(await chatView());
  } catch (e) { main.appendChild(el('div', 'alert error', esc(e.message))); }
  layout.appendChild(main);
  app.appendChild(layout);
}

/* ---------------- LOGIN ---------------- */
function loginView() {
  const wrap = el('div', 'login-wrap');
  const card = el('div', 'login-card');
  card.appendChild(el('h1', '', 'PANDOX ODA CONNECT'));
  card.appendChild(el('div', 'sub', 'Owner Dashboard — secure admin access'));
  const err = el('div', 'alert error', ''); err.style.display = 'none';
  card.appendChild(err);
  const f = el('form', '');
  const g1 = el('div', '', ''); g1.appendChild(el('label', '', 'Email')); const em = el('input', '', ''); em.type = 'email'; em.name = 'email'; g1.appendChild(em);
  const g2 = el('div', '', ''); g2.appendChild(el('label', '', 'Password')); const pw = el('input', '', ''); pw.type = 'password'; pw.name = 'password'; g2.appendChild(pw);
  const g3 = el('div', '', ''); g3.appendChild(el('label', '', '2FA code (if enabled)')); const tf = el('input', '', ''); tf.name = 'two_factor_code'; g3.appendChild(tf);
  f.appendChild(g1); f.appendChild(g2); f.appendChild(g3);
  const b = el('button', 'btn', 'Login'); b.type = 'submit'; b.style.width = '100%'; b.style.marginTop = '8px';
  f.appendChild(b);
  f.onsubmit = async (e) => {
    e.preventDefault();
    err.style.display = 'none';
    const body = Object.fromEntries(new FormData(f).entries());
    try {
      const data = await api('/auth/login', { method: 'POST', body: JSON.stringify(body) });
      if (data.two_factor_required) { err.textContent = 'Enter your 2FA code'; err.style.display = 'block'; return; }
      state.token = data.token; localStorage.setItem('pandox_admin_token', data.token);
      state.admin = data.admin;
      render();
    } catch (ex) { err.textContent = ex.message; err.style.display = 'block'; }
  };
  card.appendChild(f);
  wrap.appendChild(card);
  return wrap;
}

/* ---------------- DASHBOARD ---------------- */
async function dashboardView() {
  const v = el('div');
  try {
    const { stats } = await api('/dashboard');
    const cards = [
      ['Total users', stats.total_users, 'users'], ['Active users', stats.active_users, 'users'],
      ['Pending users', stats.pending_users, 'verifications'], ['Total providers', stats.total_providers, 'providers'],
      ['Pending providers', stats.pending_providers, 'providers'], ['Drivers', stats.drivers, 'providers'],
      ['Delivery providers', stats.delivery_providers, 'providers'], ['Hotels', stats.hotels, 'providers'],
      ['Short-stay providers', stats.short_stay_providers, 'providers'], ['Property listings', stats.property_listings, 'listings'],
      ['Today\'s bookings', stats.todays_bookings, 'bookings'], ['Pending bookings', stats.pending_bookings, 'bookings'],
      ['Completed bookings', stats.completed_bookings, 'bookings'], ['Today\'s revenue', fmtGHS(stats.todays_revenue), 'transactions'],
      ['Monthly revenue', fmtGHS(stats.monthly_revenue), 'transactions'], ['Subscription revenue', fmtGHS(stats.subscription_revenue), 'subscriptions'],
      ['Platform commission', fmtGHS(stats.platform_commission), 'commissions'], ['Refunds', stats.refunds, 'refunds'],
      ['Pending approvals', stats.pending_approvals, 'verifications'], ['Manual payments', stats.pending_manual_payments || 0, 'subscriptions'], ['Open disputes', stats.open_disputes, 'disputes']
    ];
    const grid = el('div', 'stats-grid');
    cards.forEach(([label, value, view]) => {
      const c = el('div', 'stat');
      c.appendChild(el('div', 'label', esc(label)));
      c.appendChild(el('div', 'value', esc(String(value))));
      c.onclick = () => go(view);
      c.style.cursor = 'pointer';
      grid.appendChild(c);
    });
    v.appendChild(grid);
  } catch (e) { v.appendChild(el('div', 'alert error', esc(e.message))); }
  return v;
}

/* ---------------- USERS ---------------- */
async function usersView() {
  const v = el('div');
  const panel = el('div', 'panel');
  const row = el('div', 'form-row');
  const q = el('input', '', ''); q.placeholder = 'Search name, email, phone…';
  const st = el('select', '', ''); ['', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'].forEach(o => { const op = el('option', '', o || 'All statuses'); op.value = o; st.appendChild(op); });
  const b = el('button', 'btn', 'Search');
  row.appendChild(q); row.appendChild(st); row.appendChild(b);
  panel.appendChild(row);
  v.appendChild(panel);
  const tbody = el('tbody', '');
  const load = async () => {
    const params = new URLSearchParams();
    if (q.value) params.set('q', q.value);
    if (st.value) params.set('status', st.value);
    const { users } = await api(`/users?${params}`);
    tbody.innerHTML = '';
    users.forEach(u => {
      const tr = el('tr', '');
      tr.innerHTML = `<td>${esc(u.full_name || '—')}</td><td>${esc(u.email)}</td><td>${esc(u.phone || '—')}</td><td>${badge(u.status)}</td><td>${badge(u.identity_status || 'NOT_SUBMITTED')}</td><td>${fmtDate(u.created_at)}</td>`;
      const act = el('td', '');
      if (u.status === 'ACTIVE') {
        const s = el('button', 'btn sm danger', 'Suspend');
        s.onclick = async () => { if (confirm(`Suspend ${u.full_name}?`)) { await api(`/users/${u.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'SUSPENDED' }) }); toast('User suspended'); load(); } };
        act.appendChild(s);
      } else if (u.status === 'SUSPENDED') {
        const r = el('button', 'btn sm', 'Reactivate');
        r.onclick = async () => { await api(`/users/${u.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'ACTIVE' }) }); toast('User reactivated'); load(); };
        act.appendChild(r);
      }
      tr.appendChild(act);
      tbody.appendChild(tr);
    });
  };
  b.onclick = load;
  const t = el('table', 'table');
  t.innerHTML = '<thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Status</th><th>ID</th><th>Joined</th><th></th></tr></thead>';
  t.appendChild(tbody);
  v.appendChild(t);
  load();
  return v;
}

/* ---------------- PROVIDERS ---------------- */
async function providersView() {
  const v = el('div');
  const panel = el('div', 'panel');
  const row = el('div', 'form-row');
  const st = el('select', '', ''); ['', 'PENDING_VERIFICATION', 'APPROVED', 'REJECTED', 'SUSPENDED'].forEach(o => { const op = el('option', '', o || 'All statuses'); op.value = o; st.appendChild(op); });
  const ty = el('select', '', ''); ['', 'driver', 'delivery', 'hotel', 'short_stay', 'apartment', 'property'].forEach(o => { const op = el('option', '', o || 'All types'); op.value = o; ty.appendChild(op); });
  const b = el('button', 'btn', 'Filter');
  row.appendChild(st); row.appendChild(ty); row.appendChild(b);
  panel.appendChild(row);
  v.appendChild(panel);
  const tbody = el('tbody', '');
  const load = async () => {
    const params = new URLSearchParams();
    if (st.value) params.set('status', st.value);
    if (ty.value) params.set('type', ty.value);
    const { providers } = await api(`/providers?${params}`);
    tbody.innerHTML = '';
    providers.forEach(p => {
      const tr = el('tr', '');
      tr.innerHTML = `<td>${esc(p.business_name || p.full_name)}</td><td>${esc(p.provider_type)}</td><td>${esc(p.full_name)}</td><td>${badge(p.status)}</td><td>${badge(p.subscription_status || 'NONE')}</td>`;
      const act = el('td', '');
      if (p.status === 'PENDING_VERIFICATION') {
        const a = el('button', 'btn sm', 'Approve');
        a.onclick = async () => { await api(`/providers/${p.id}/verify`, { method: 'POST', body: JSON.stringify({ action: 'APPROVED' }) }); toast('Provider approved'); load(); };
        const r = el('button', 'btn sm danger', 'Reject');
        r.onclick = async () => { const note = prompt('Rejection reason:'); await api(`/providers/${p.id}/verify`, { method: 'POST', body: JSON.stringify({ action: 'REJECTED', note }) }); toast('Provider rejected'); load(); };
        act.appendChild(a); act.appendChild(r);
      } else if (p.status === 'APPROVED') {
        const s = el('button', 'btn sm danger', 'Suspend');
        s.onclick = async () => { if (confirm('Suspend this provider?')) { await api(`/providers/${p.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'SUSPENDED' }) }); toast('Provider suspended'); load(); } };
        act.appendChild(s);
      } else if (p.status === 'SUSPENDED') {
        const r = el('button', 'btn sm', 'Reactivate');
        r.onclick = async () => { await api(`/providers/${p.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'APPROVED' }) }); toast('Provider reactivated'); load(); };
        act.appendChild(r);
      }
      tr.appendChild(act);
      tbody.appendChild(tr);
    });
  };
  b.onclick = load;
  const t = el('table', 'table');
  t.innerHTML = '<thead><tr><th>Business</th><th>Type</th><th>Owner</th><th>Status</th><th>Subscription</th><th></th></tr></thead>';
  t.appendChild(tbody);
  v.appendChild(t);
  load();
  return v;
}

/* ---------------- VERIFICATIONS ---------------- */
async function verificationsView() {
  const v = el('div');
  const tbody = el('tbody', '');
  const load = async () => {
    const { verifications } = await api('/verifications');
    tbody.innerHTML = '';
    verifications.forEach(u => {
      const tr = el('tr', '');
      tr.innerHTML = `<td>${esc(u.full_name)}</td><td>${esc(u.email)}</td><td>${esc(u.identity_type || '—')}</td><td>${badge(u.identity_status || 'NOT_SUBMITTED')}</td><td>${fmtDate(u.created_at)}</td>`;
      const act = el('td', '');
      if (u.identity_status === 'PENDING' || u.identity_status === 'UNDER_REVIEW' || u.identity_status === 'REQUEST_RESUBMISSION') {
        const a = el('button', 'btn sm', 'Approve');
        a.onclick = async () => { await api(`/verifications/${u.id}/review`, { method: 'POST', body: JSON.stringify({ action: 'APPROVED' }) }); toast('Identity approved'); load(); };
        const r = el('button', 'btn sm danger', 'Reject');
        r.onclick = async () => { const note = prompt('Reason:'); await api(`/verifications/${u.id}/review`, { method: 'POST', body: JSON.stringify({ action: 'REJECTED', note }) }); toast('Rejected'); load(); };
        const rs = el('button', 'btn sm secondary', 'Request resubmission');
        rs.onclick = async () => { const note = prompt('What to resubmit:'); await api(`/verifications/${u.id}/review`, { method: 'POST', body: JSON.stringify({ action: 'REQUEST_RESUBMISSION', note }) }); toast('Resubmission requested'); load(); };
        act.appendChild(a); act.appendChild(r); act.appendChild(rs);
      }
      tr.appendChild(act);
      tbody.appendChild(tr);
    });
  };
  const t = el('table', 'table');
  t.innerHTML = '<thead><tr><th>Name</th><th>Email</th><th>ID type</th><th>Status</th><th>Submitted</th><th></th></tr></thead>';
  t.appendChild(tbody);
  v.appendChild(t);
  load();
  return v;
}

/* ---------------- LISTINGS ---------------- */
async function listingsView() {
  const v = el('div');
  const tbody = el('tbody', '');
  const load = async () => {
    const { listings } = await api('/listings');
    tbody.innerHTML = '';
    listings.forEach(l => {
      const tr = el('tr', '');
      tr.innerHTML = `<td>${esc(l.title)}</td><td>${esc(l.category)}</td><td>${esc(l.provider_name || l.business_name)}</td><td>${badge(l.status)}</td><td>${l.price_per_night ? fmtGHS(l.price_per_night) + '/n' : l.price_per_month ? fmtGHS(l.price_per_month) + '/m' : '—'}</td>`;
      const act = el('td', '');
      if (l.status === 'PENDING') {
        const a = el('button', 'btn sm', 'Approve');
        a.onclick = async () => { await api(`/listings/${l.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'APPROVED' }) }); toast('Listing approved'); load(); };
        const r = el('button', 'btn sm danger', 'Reject');
        r.onclick = async () => { await api(`/listings/${l.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'REJECTED' }) }); toast('Listing rejected'); load(); };
        act.appendChild(a); act.appendChild(r);
      } else if (l.status === 'APPROVED') {
        const s = el('button', 'btn sm danger', 'Suspend');
        s.onclick = async () => { await api(`/listings/${l.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'SUSPENDED' }) }); toast('Listing suspended'); load(); };
        act.appendChild(s);
      } else if (l.status === 'SUSPENDED') {
        const r = el('button', 'btn sm', 'Restore');
        r.onclick = async () => { await api(`/listings/${l.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'APPROVED' }) }); toast('Listing restored'); load(); };
        act.appendChild(r);
      }
      tr.appendChild(act);
      tbody.appendChild(tr);
    });
  };
  const t = el('table', 'table');
  t.innerHTML = '<thead><tr><th>Title</th><th>Category</th><th>Provider</th><th>Status</th><th>Price</th><th></th></tr></thead>';
  t.appendChild(tbody);
  v.appendChild(t);
  load();
  return v;
}

/* ---------------- BOOKINGS ---------------- */
async function bookingsView() {
  const v = el('div');
  const tbody = el('tbody', '');
  const load = async () => {
    const { bookings } = await api('/bookings');
    tbody.innerHTML = '';
    bookings.forEach(b => {
      const tr = el('tr', '');
      tr.innerHTML = `<td>${esc(b.booking_ref)}</td><td>${esc(b.category)}</td><td>${esc(b.customer_name)}</td><td>${esc(b.provider_name || '—')}</td><td>${badge(b.status)}</td><td>${fmtGHS(b.amount)}</td><td>${fmtDate(b.created_at)}</td>`;
      const act = el('td', '');
      if (!['COMPLETED', 'CANCELLED'].includes(b.status)) {
        const c = el('button', 'btn sm danger', 'Cancel');
        c.onclick = async () => { if (confirm('Cancel this booking?')) { await api(`/bookings/${b.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: 'Cancelled by platform' }) }); toast('Booking cancelled'); load(); } };
        act.appendChild(c);
      }
      tr.appendChild(act);
      tbody.appendChild(tr);
    });
  };
  const t = el('table', 'table');
  t.innerHTML = '<thead><tr><th>Ref</th><th>Category</th><th>Customer</th><th>Provider</th><th>Status</th><th>Amount</th><th>Date</th><th></th></tr></thead>';
  t.appendChild(tbody);
  v.appendChild(t);
  load();
  return v;
}

/* ---------------- DISPUTES ---------------- */
async function disputesView() {
  const v = el('div');
  const tbody = el('tbody', '');
  const load = async () => {
    const { disputes } = await api('/disputes');
    tbody.innerHTML = '';
    disputes.forEach(d => {
      const tr = el('tr', '');
      tr.innerHTML = `<td>${esc(d.dispute_ref)}</td><td>${esc(d.category)}</td><td>${esc(d.raised_by_name)}</td><td>${badge(d.status)}</td><td>${fmtDate(d.created_at)}</td>`;
      const act = el('td', '');
      if (d.status === 'OPEN') {
        const r = el('button', 'btn sm', 'Review');
        r.onclick = async () => { await api(`/disputes/${d.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'UNDER_REVIEW' }) }); toast('Under review'); load(); };
        act.appendChild(r);
      }
      if (d.status === 'UNDER_REVIEW') {
        const rs = el('button', 'btn sm', 'Resolve');
        rs.onclick = async () => { const resolution = prompt('Resolution:'); await api(`/disputes/${d.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'RESOLVED', resolution }) }); toast('Resolved'); load(); };
        act.appendChild(rs);
      }
      if (!['CLOSED'].includes(d.status)) {
        const c = el('button', 'btn sm secondary', 'Close');
        c.onclick = async () => { await api(`/disputes/${d.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'CLOSED' }) }); toast('Closed'); load(); };
        act.appendChild(c);
      }
      tr.appendChild(act);
      tbody.appendChild(tr);
    });
  };
  const t = el('table', 'table');
  t.innerHTML = '<thead><tr><th>Ref</th><th>Category</th><th>Raised by</th><th>Status</th><th>Date</th><th></th></tr></thead>';
  t.appendChild(tbody);
  v.appendChild(t);
  load();
  return v;
}

/* ---------------- TRANSACTIONS ---------------- */
async function transactionsView() {
  const v = el('div');
  const tbody = el('tbody', '');
  const load = async () => {
    const { transactions } = await api('/transactions');
    tbody.innerHTML = '';
    transactions.forEach(tx => {
      const tr = el('tr', '');
      tr.innerHTML = `<td>${esc(tx.txn_ref)}</td><td>${esc(tx.type)}</td><td>${fmtGHS(tx.amount)}</td><td>${fmtGHS(tx.platform_fee)}</td><td>${fmtGHS(tx.provider_amount)}</td><td>${badge(tx.status)}</td><td>${badge(tx.refund_status || 'NONE')}</td><td>${fmtDT(tx.created_at)}</td>`;
      tbody.appendChild(tr);
    });
  };
  const t = el('table', 'table');
  t.innerHTML = '<thead><tr><th>Ref</th><th>Type</th><th>Amount</th><th>Platform fee</th><th>Provider</th><th>Status</th><th>Refund</th><th>Date</th></tr></thead>';
  t.appendChild(tbody);
  v.appendChild(t);
  load();
  return v;
}

/* ---------------- REFUNDS ---------------- */
async function refundsView() {
  const v = el('div');
  const panel = el('div', 'panel');
  panel.appendChild(el('h3', '', 'Request a refund'));
  const row = el('div', 'form-row');
  const tid = el('input', '', ''); tid.placeholder = 'Transaction ID';
  const amt = el('input', '', ''); amt.placeholder = 'Amount (GH₵)'; amt.type = 'number';
  const reason = el('input', '', ''); reason.placeholder = 'Reason';
  const b = el('button', 'btn', 'Create refund request');
  row.appendChild(tid); row.appendChild(amt); row.appendChild(reason); row.appendChild(b);
  panel.appendChild(row);
  b.onclick = async () => {
    try { await api('/refunds', { method: 'POST', body: JSON.stringify({ transaction_id: tid.value, amount: amt.value, reason: reason.value }) }); toast('Refund requested'); load(); }
    catch (e) { toast(e.message); }
  };
  v.appendChild(panel);
  const tbody = el('tbody', '');
  const load = async () => {
    const { refunds } = await api('/refunds');
    tbody.innerHTML = '';
    refunds.forEach(r => {
      const tr = el('tr', '');
      tr.innerHTML = `<td>${esc(r.refund_ref)}</td><td>${esc(r.customer_name)}</td><td>${fmtGHS(r.amount)}</td><td>${badge(r.status)}</td><td>${fmtDate(r.created_at)}</td>`;
      const act = el('td', '');
      if (r.status === 'REQUESTED') {
        const a = el('button', 'btn sm', 'Approve');
        a.onclick = async () => { await api(`/refunds/${r.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'APPROVED' }) }); toast('Approved'); load(); };
        const rj = el('button', 'btn sm danger', 'Reject');
        rj.onclick = async () => { await api(`/refunds/${r.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'REJECTED' }) }); toast('Rejected'); load(); };
        act.appendChild(a); act.appendChild(rj);
      } else if (r.status === 'APPROVED') {
        const p = el('button', 'btn sm accent', 'Process via gateway');
        p.onclick = async () => { try { await api(`/refunds/${r.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'PROCESSED' }) }); toast('Refund processed'); load(); } catch (e) { toast(e.message); } };
        act.appendChild(p);
      }
      tr.appendChild(act);
      tbody.appendChild(tr);
    });
  };
  const t = el('table', 'table');
  t.innerHTML = '<thead><tr><th>Ref</th><th>Customer</th><th>Amount</th><th>Status</th><th>Date</th><th></th></tr></thead>';
  t.appendChild(tbody);
  v.appendChild(t);
  load();
  return v;
}

/* ---------------- SUBSCRIPTIONS ---------------- */
async function subscriptionsView() {
  const v = el('div');
  const panel = el('div', 'panel');
  panel.appendChild(el('h3', '', 'Subscription plans (owner-configurable)'));
  const { plans } = await api('/subscription-plans');
  const grid = el('div', 'grid', '');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px';
  plans.forEach(p => {
    const c = el('div', 'card', '');
    c.appendChild(el('h4', '', esc(p.name)));
    c.appendChild(el('p', 'muted', esc(p.description || '')));
    const f = el('form', '');
    const g1 = el('div', '', ''); g1.appendChild(el('label', '', 'Price (GH₵)')); const pr = el('input', '', ''); pr.value = p.price; pr.type = 'number'; g1.appendChild(pr);
    const g2 = el('div', '', ''); g2.appendChild(el('label', '', 'Period (days)')); const pd = el('input', '', ''); pd.value = p.billing_period_days; pd.type = 'number'; g2.appendChild(pd);
    const g3 = el('div', '', ''); g3.appendChild(el('label', '', 'Trial (days)')); const td = el('input', '', ''); td.value = p.trial_days || 0; td.type = 'number'; g3.appendChild(td);
    const row = el('div', 'form-row', ''); row.appendChild(g1); row.appendChild(g2); row.appendChild(g3);
    f.appendChild(row);
    const b = el('button', 'btn sm', 'Save plan'); b.type = 'submit';
    f.appendChild(b);
    f.onsubmit = async (e) => {
      e.preventDefault();
      await api(`/subscription-plans/${p.id}`, { method: 'PUT', body: JSON.stringify({ price: pr.value, billing_period_days: pd.value, trial_days: td.value }) });
      toast('Plan updated');
    };
    c.appendChild(f);
    grid.appendChild(c);
  });
  panel.appendChild(grid);
  v.appendChild(panel);

  const manualPanel = el('div', 'panel');
  manualPanel.appendChild(el('h3', '', 'Manual payment reports'));
  const manualBody = el('tbody', '');
  const manualLoad = async () => {
    const { submissions } = await api('/manual-payment-submissions');
    manualBody.innerHTML = '';
    if (!submissions.length) { manualBody.innerHTML = '<tr><td colspan="8" class="muted">No manual payment reports yet.</td></tr>'; return; }
    submissions.forEach(m => {
      const tr = el('tr', '');
      tr.innerHTML = `<td>${esc(m.full_name)}</td><td>${esc(m.email)}</td><td>${esc(m.plan_name)}</td><td>${fmtGHS(m.amount)}</td><td>${badge(m.status)}</td><td>${fmtDT(m.reported_at || m.created_at)}</td>`;
      const act = el('td', '');
      if (m.status === 'PAID_REPORTED') {
        const approve = el('button', 'btn sm', 'Verify & activate');
        approve.onclick = async () => { if (confirm(`Verify payment from ${m.full_name}?`)) { await api(`/manual-payment-submissions/${m.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'APPROVED' }) }); toast('Payment verified and subscription activated'); manualLoad(); } };
        const reject = el('button', 'btn sm danger', 'Reject');
        reject.onclick = async () => { if (confirm(`Reject payment report from ${m.full_name}?`)) { await api(`/manual-payment-submissions/${m.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'REJECTED' }) }); toast('Payment report rejected'); manualLoad(); } };
        act.appendChild(approve); act.appendChild(reject);
      }
      tr.appendChild(act); manualBody.appendChild(tr);
    });
  };
  const manualTable = el('table', 'table');
  manualTable.innerHTML = '<thead><tr><th>User</th><th>Email</th><th>Plan</th><th>Amount</th><th>Status</th><th>Reported</th><th>Actions</th></tr></thead>';
  manualTable.appendChild(manualBody); manualPanel.appendChild(manualTable); v.appendChild(manualPanel);
  manualLoad();
  const tbody = el('tbody', '');
  const load = async () => {
    const { subscriptions } = await api('/subscriptions');
    tbody.innerHTML = '';
    subscriptions.forEach(s => {
      const tr = el('tr', '');
      tr.innerHTML = `<td>${esc(s.full_name)}</td><td>${esc(s.plan_name)}</td><td>${esc(s.audience)}</td><td>${badge(s.status)}</td><td>${badge(s.payment_status || 'NONE')}</td><td>${fmtDate(s.starts_at)}</td><td>${fmtDate(s.expires_at)}</td>`;
      tbody.appendChild(tr);
    });
  };
  const t = el('table', 'table');
  t.innerHTML = '<thead><tr><th>User</th><th>Plan</th><th>Audience</th><th>Status</th><th>Payment</th><th>Start</th><th>Expires</th></tr></thead>';
  t.appendChild(tbody);
  v.appendChild(t);
  load();
  return v;
}

/* ---------------- COMMISSIONS ---------------- */
async function commissionsView() {
  const v = el('div');
  const { commissions } = await api('/commissions');
  const grid = el('div', 'grid', '');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px';
  commissions.forEach(c => {
    const card = el('div', 'card', '');
    card.appendChild(el('h4', '', esc(c.category)));
    const f = el('form', '');
    const g1 = el('div', '', ''); g1.appendChild(el('label', '', 'Percent (%)')); const pct = el('input', '', ''); pct.value = c.percent; pct.type = 'number'; g1.appendChild(pct);
    const g2 = el('div', '', ''); g2.appendChild(el('label', '', 'Fixed fee (GH₵)')); const fx = el('input', '', ''); fx.value = c.fixed_fee; fx.type = 'number'; g2.appendChild(fx);
    const row = el('div', 'form-row', ''); row.appendChild(g1); row.appendChild(g2);
    f.appendChild(row);
    const b = el('button', 'btn sm', 'Save'); b.type = 'submit';
    f.appendChild(b);
    f.onsubmit = async (e) => {
      e.preventDefault();
      await api(`/commissions/${c.category}`, { method: 'PUT', body: JSON.stringify({ percent: pct.value, fixed_fee: fx.value }) });
      toast('Commission updated');
    };
    card.appendChild(f);
    grid.appendChild(card);
  });
  v.appendChild(grid);
  return v;
}

/* ---------------- CONTROLS ---------------- */
async function controlsView() {
  const v = el('div');
  v.appendChild(el('div', 'alert info', 'Emergency platform controls. Changes are audit-logged.'));
  const { controls } = await api('/controls');
  const defs = {
    registrations: ['Pause new registrations', 'Block new customer accounts'],
    bookings: ['Pause bookings', 'Block new bookings platform-wide'],
    payments: ['Pause payments', 'Block payment initialization'],
    provider_registrations: ['Pause provider registrations', 'Block new provider signups'],
    transportation: ['Disable transportation', 'Turn off rides module'],
    delivery: ['Disable delivery', 'Turn off delivery module'],
    hotels: ['Disable hotels', 'Turn off hotel module'],
    short_stay: ['Disable short-stay', 'Turn off short-stay module'],
    property: ['Disable property listings', 'Turn off apartment/property module'],
    maintenance: ['Maintenance mode', 'Show maintenance notice to all users']
  };
  const grid = el('div', 'controls-grid');
  Object.entries(defs).forEach(([key, [name, desc]]) => {
    const item = el('div', 'control-item');
    const left = el('div', '', '');
    left.appendChild(el('div', 'name', esc(name)));
    left.appendChild(el('div', 'desc', esc(desc)));
    const on = controls[key] === 'on';
    const lab = el('label', 'toggle');
    const inp = el('input', '', ''); inp.type = 'checkbox'; inp.checked = on;
    inp.onchange = async () => {
      if (confirm(`Turn ${inp.checked ? 'ON' : 'OFF'}: ${name}? This is logged.`)) {
        await api('/controls', { method: 'POST', body: JSON.stringify({ key, value: inp.checked ? 'on' : 'off' }) });
        toast(`${name} ${inp.checked ? 'enabled' : 'disabled'}`);
      } else inp.checked = !inp.checked;
    };
    lab.appendChild(inp);
    lab.appendChild(el('span', 'slider', ''));
    item.appendChild(left); item.appendChild(lab);
    grid.appendChild(item);
  });
  v.appendChild(grid);
  return v;
}

/* ---------------- SETTINGS ---------------- */
async function settingsView() {
  const v = el('div');
  const { settings } = await api('/settings');
  const panel = el('div', 'panel');
  panel.appendChild(el('h3', '', 'Platform settings'));
  const f = el('form', '');
  const fields = [
    ['platform_name', 'Platform name', 'text'], ['platform_tagline', 'Tagline', 'text'],
    ['support_email', 'Support email', 'email'], ['support_phone', 'Support phone', 'text'],
    ['marketplace_disclaimer', 'Marketplace disclaimer', 'text'],
    ['listing_approval_required', 'Listing approval required (1/0)', 'text'],
    ['cancellation_window_minutes', 'Cancellation window (minutes)', 'number'],
    ['cancellation_fee_percent', 'Cancellation fee (%)', 'number'],
    ['ride_estimation_enabled', 'Ride estimation enabled (1/0)', 'text'],
    ['maps_enabled', 'Maps enabled (1/0)', 'text'],
    ['email_enabled', 'Email notifications (1/0)', 'text'],
    ['sms_enabled', 'SMS notifications (1/0)', 'text'],
    ['push_enabled', 'Push notifications (1/0)', 'text']
  ];
  const row = el('div', 'form-row', '');
  fields.forEach(([key, label, type]) => {
    const g = el('div', '', '');
    g.appendChild(el('label', '', esc(label)));
    const inp = el('input', '', ''); inp.type = type; inp.name = key; inp.value = settings[key] || '';
    g.appendChild(inp);
    row.appendChild(g);
  });
  f.appendChild(row);
  const b = el('button', 'btn', 'Save settings'); b.type = 'submit';
  f.appendChild(b);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(f).entries());
    await api('/settings', { method: 'PUT', body: JSON.stringify(body) });
    toast('Settings saved');
  };
  panel.appendChild(f);
  v.appendChild(panel);
  return v;
}

/* ---------------- POLICIES ---------------- */
async function policiesView() {
  const v = el('div');
  const { policies } = await api('/policies');
  policies.forEach(p => {
    const panel = el('div', 'panel');
    panel.appendChild(el('h3', '', `${esc(p.title)} <span class="badge gray">v${p.version}</span>`));
    const ta = el('textarea', '', esc(p.content));
    ta.style.cssText = 'min-height:120px;margin-bottom:10px';
    const b = el('button', 'btn sm', 'Save & bump version');
    b.onclick = async () => { await api(`/policies/${p.id}`, { method: 'PUT', body: JSON.stringify({ content: ta.value }) }); toast('Policy updated — version bumped'); policiesView(); };
    panel.appendChild(ta); panel.appendChild(b);
    v.appendChild(panel);
  });
  return v;
}

/* ---------------- CAMPAIGNS ---------------- */
async function campaignsView() {
  const v = el('div');
  const panel = el('div', 'panel');
  panel.appendChild(el('h3', '', 'Send a notification campaign'));
  const f = el('form', '');
  const row = el('div', 'form-row', '');
  const g1 = el('div', '', ''); g1.appendChild(el('label', '', 'Title')); const titleInput = el('input', '', ''); titleInput.name = 'title'; g1.appendChild(titleInput);
  const g2 = el('div', '', ''); g2.appendChild(el('label', '', 'Audience')); const a = el('select', '', ''); ['all', 'customers', 'providers', 'drivers', 'hotels'].forEach(o => { const op = el('option', '', o); op.value = o; a.appendChild(op); }); a.name = 'audience'; g2.appendChild(a);
  row.appendChild(g1); row.appendChild(g2);
  f.appendChild(row);
  const g3 = el('div', '', ''); g3.appendChild(el('label', '', 'Message')); const m = el('textarea', '', ''); m.name = 'body'; m.style.cssText = 'min-height:80px'; g3.appendChild(m);
  f.appendChild(g3);
  const b = el('button', 'btn', 'Create campaign'); b.type = 'submit';
  f.appendChild(b);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(f).entries());
    try { const r = await api('/campaigns', { method: 'POST', body: JSON.stringify(body) }); toast('Campaign created'); sendCampaign(r.campaign.id); }
    catch (ex) { toast(ex.message); }
  };
  panel.appendChild(f);
  v.appendChild(panel);
  const sendCampaign = async (id) => {
    try { const r = await api(`/campaigns/${id}/send`, { method: 'POST' }); toast(`Campaign sent to ${r.sent} users`); }
    catch (e) { toast(e.message); }
  };
  const tbody = el('tbody', '');
  const { campaigns } = await api('/campaigns');
  campaigns.forEach(c => {
    const tr = el('tr', '');
    tr.innerHTML = `<td>${esc(c.title)}</td><td>${esc(c.audience)}</td><td>${badge(c.status)}</td><td>${fmtDate(c.created_at)}</td>`;
    tbody.appendChild(tr);
  });
  const t = el('table', 'table');
  t.innerHTML = '<thead><tr><th>Title</th><th>Audience</th><th>Status</th><th>Date</th></tr></thead>';
  t.appendChild(tbody);
  v.appendChild(t);
  return v;
}

/* ---------------- STAFF ---------------- */
async function staffView() {
  const v = el('div');
  const panel = el('div', 'panel');
  panel.appendChild(el('h3', '', 'Create admin staff'));
  const f = el('form', '');
  const row = el('div', 'form-row', '');
  const g1 = el('div', '', ''); g1.appendChild(el('label', '', 'Full name')); const n = el('input', '', ''); n.name = 'full_name'; g1.appendChild(n);
  const g2 = el('div', '', ''); g2.appendChild(el('label', '', 'Email')); const e = el('input', '', ''); e.name = 'email'; e.type = 'email'; g2.appendChild(e);
  const g3 = el('div', '', ''); g3.appendChild(el('label', '', 'Password (min 10 chars)')); const p = el('input', '', ''); p.name = 'password'; p.type = 'password'; g3.appendChild(p);
  const g4 = el('div', '', ''); g4.appendChild(el('label', '', 'Role')); const r = el('select', '', ''); ['FINANCE_ADMIN', 'VERIFICATION_ADMIN', 'SUPPORT_ADMIN', 'DISPUTE_ADMIN', 'CONTENT_ADMIN', 'TECH_ADMIN'].forEach(o => { const op = el('option', '', o); op.value = o; r.appendChild(op); }); r.name = 'role'; g4.appendChild(r);
  row.appendChild(g1); row.appendChild(g2); row.appendChild(g3); row.appendChild(g4);
  f.appendChild(row);
  const b = el('button', 'btn', 'Create admin'); b.type = 'submit';
  f.appendChild(b);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(f).entries());
    try { await api('/staff', { method: 'POST', body: JSON.stringify(body) }); toast('Admin created'); staffView(); }
    catch (ex) { toast(ex.message); }
  };
  panel.appendChild(f);
  v.appendChild(panel);
  const tbody = el('tbody', '');
  const { staff } = await api('/staff');
  staff.forEach(s => {
    const tr = el('tr', '');
    tr.innerHTML = `<td>${esc(s.full_name)}</td><td>${esc(s.email)}</td><td>${badge(s.role)}</td><td>${s.two_factor_enabled ? badge('2FA ON') : badge('2FA OFF')}</td><td>${fmtDT(s.last_login_at)}</td>`;
    tbody.appendChild(tr);
  });
  const t = el('table', 'table');
  t.innerHTML = '<thead><tr><th>Name</th><th>Email</th><th>Role</th><th>2FA</th><th>Last login</th></tr></thead>';
  t.appendChild(tbody);
  v.appendChild(t);
  return v;
}

/* ---------------- AUDIT ---------------- */
async function auditView() {
  const v = el('div');
  const tbody = el('tbody', '');
  const { logs } = await api('/audit-logs');
  logs.forEach(l => {
    const tr = el('tr', '');
    tr.innerHTML = `<td>${esc(l.admin_email || 'system')}</td><td>${esc(l.action)}</td><td>${esc(l.target_type || '—')}</td><td>${esc(l.target_id || '—')}</td><td>${fmtDT(l.created_at)}</td>`;
    tbody.appendChild(tr);
  });
  const t = el('table', 'table');
  t.innerHTML = '<thead><tr><th>Admin</th><th>Action</th><th>Target</th><th>ID</th><th>Time</th></tr></thead>';
  t.appendChild(tbody);
  v.appendChild(t);
  return v;
}

/* ---------------- SESSIONS ---------------- */
async function sessionsView() {
  const v = el('div');
  const tbody = el('tbody', '');
  const load = async () => {
    const { sessions } = await api('/sessions');
    tbody.innerHTML = '';
    sessions.forEach(s => {
      const tr = el('tr', '');
      tr.innerHTML = `<td>${esc(s.email)}</td><td>${esc(s.ip || '—')}</td><td>${fmtDT(s.created_at)}</td><td>${fmtDT(s.expires_at)}</td>`;
      const act = el('td', '');
      const r = el('button', 'btn sm danger', 'Revoke');
      r.onclick = async () => { await api('/sessions/revoke', { method: 'POST', body: JSON.stringify({ session_id: s.id }) }); toast('Session revoked'); load(); };
      act.appendChild(r);
      tr.appendChild(act);
      tbody.appendChild(tr);
    });
  };
  const t = el('table', 'table');
  t.innerHTML = '<thead><tr><th>Admin</th><th>IP</th><th>Created</th><th>Expires</th><th></th></tr></thead>';
  t.appendChild(tbody);
  v.appendChild(t);
  load();
  return v;
}

/* ---------------- REPORTS ---------------- */
async function reportsView() {
  const v = el('div');
  const panel = el('div', 'panel');
  panel.appendChild(el('h3', '', 'Reports'));
  const row = el('div', 'form-row', '');
  const sel = el('select', '', ''); ['day', 'month', 'year'].forEach(o => { const op = el('option', '', o); op.value = o; sel.appendChild(op); });
  const b = el('button', 'btn', 'Generate');
  row.appendChild(sel); row.appendChild(b);
  panel.appendChild(row);
  const out = el('div', '', '');
  panel.appendChild(out);
  b.onclick = async () => {
    const r = await api(`/reports?period=${sel.value}`);
    out.innerHTML = '';
    const grid = el('div', 'stats-grid');
    const rev = r.revenue.reduce((s, x) => s + x.revenue, 0);
    const com = r.revenue.reduce((s, x) => s + x.commission, 0);
    const prov = r.revenue.reduce((s, x) => s + x.provider_earnings, 0);
    grid.appendChild(el('div', 'stat', `<div class="label">Revenue</div><div class="value">${fmtGHS(rev)}</div>`));
    grid.appendChild(el('div', 'stat', `<div class="label">Commission</div><div class="value">${fmtGHS(com)}</div>`));
    grid.appendChild(el('div', 'stat', `<div class="label">Provider earnings</div><div class="value">${fmtGHS(prov)}</div>`));
    grid.appendChild(el('div', 'stat', `<div class="label">Bookings</div><div class="value">${r.bookings.reduce((s, x) => s + x.count, 0)}</div>`));
    out.appendChild(grid);
    const t = el('table', 'table');
    t.innerHTML = '<thead><tr><th>Period</th><th>Revenue</th><th>Commission</th><th>Provider</th><th>Bookings</th><th>New users</th><th>New providers</th><th>Refunds</th></tr></thead>';
    const tb = el('tbody', '');
    const periods = new Set([...r.revenue, ...r.bookings, ...r.users, ...r.providers, ...r.refunds].map(x => x.period));
    [...periods].sort().reverse().forEach(p => {
      const revRow = r.revenue.find(x => x.period === p) || {};
      const bkRow = r.bookings.find(x => x.period === p) || {};
      const usRow = r.users.find(x => x.period === p) || {};
      const prRow = r.providers.find(x => x.period === p) || {};
      const rfRow = r.refunds.find(x => x.period === p) || {};
      const tr = el('tr', '');
      tr.innerHTML = `<td>${esc(p)}</td><td>${fmtGHS(revRow.revenue)}</td><td>${fmtGHS(revRow.commission)}</td><td>${fmtGHS(revRow.provider_earnings)}</td><td>${bkRow.count || 0}</td><td>${usRow.count || 0}</td><td>${prRow.count || 0}</td><td>${fmtGHS(rfRow.amount)}</td>`;
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    out.appendChild(t);
    const sp = el('div', 'panel', '');
    sp.appendChild(el('h3', '', 'Service performance'));
    const st = el('table', 'table');
    st.innerHTML = '<thead><tr><th>Category</th><th>Bookings</th><th>Completed</th><th>Avg rating</th></tr></thead>';
    const stb = el('tbody', '');
    r.service_performance.forEach(s => {
      const tr = el('tr', '');
      tr.innerHTML = `<td>${esc(s.category)}</td><td>${s.bookings}</td><td>${s.completed}</td><td>${s.avg_rating ? Number(s.avg_rating).toFixed(1) : '—'}</td>`;
      stb.appendChild(tr);
    });
    st.appendChild(stb);
    sp.appendChild(st);
    out.appendChild(sp);
  };
  v.appendChild(panel);
  return v;
}

/* ---------------- CHAT ---------------- */
async function chatView() {
  const v = el('div', '');
  const panel = el('div', 'panel');
  panel.appendChild(el('h3', '', 'Messages with users'));
  const row = el('div', 'form-row');
  const q = el('input', '', ''); q.placeholder = 'Search user name, email or phone…';
  const b = el('button', 'btn', 'Search');
  row.appendChild(q); row.appendChild(b);
  panel.appendChild(row);
  v.appendChild(panel);

  const list = el('div', '');
  list.style.marginTop = '16px';
  const load = async () => {
    list.innerHTML = '';
    try {
      const { users } = await api(`/chat/users?q=${encodeURIComponent(q.value)}`);
      if (!users.length) { list.appendChild(el('div', 'empty', 'No users found.')); return; }
      users.forEach(u => {
        const card = el('div', 'panel');
        card.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding:14px 16px';
        const left = el('div', '');
        left.appendChild(el('div', '', `<strong>${esc(u.full_name || u.email)}</strong> <span class="badge ${u.role === 'admin' ? 'blue' : 'gray'}">${esc(u.role)}</span>`));
        left.appendChild(el('div', 'muted', `${esc(u.email)} · ${esc(u.phone || '—')}`));
        const btn = el('button', 'btn sm', 'Message');
        btn.onclick = async () => {
          try {
            const { conversation } = await api('/chat/conversations', { method: 'POST', body: JSON.stringify({ user_id: u.id }) });
            openThread(conversation.id);
          } catch (ex) { toast(ex.message); }
        };
        card.appendChild(left); card.appendChild(btn);
        list.appendChild(card);
      });
    } catch (e) { list.appendChild(el('div', 'alert error', esc(e.message))); }
  };
  b.onclick = load;
  v.appendChild(list);

  // Existing conversations
  const convPanel = el('div', 'panel');
  convPanel.style.marginTop = '16px';
  convPanel.appendChild(el('h3', '', 'Your conversations'));
  const convList = el('div', '');
  const loadConvs = async () => {
    convList.innerHTML = '';
    try {
      const { conversations } = await api('/chat/conversations');
      if (!conversations.length) { convList.appendChild(el('div', 'empty', 'No conversations yet. Search a user above to start one.')); return; }
      conversations.forEach(c => {
        const card = el('div', '');
        card.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:8px;cursor:pointer;background:#fff';
        const left = el('div', '');
        left.appendChild(el('div', '', `<strong>${esc(c.other_name || c.other_email)}</strong> <span class="muted">· ${esc(c.other_role)}</span>`));
        left.appendChild(el('div', 'muted', esc(c.last_message || 'No messages yet')));
        const right = el('div', '');
        if (c.unread > 0) right.appendChild(el('span', 'badge red', String(c.unread)));
        right.appendChild(el('div', 'muted', fmtDT(c.last_message_at)));
        card.appendChild(left); card.appendChild(right);
        card.onclick = () => openThread(c.id);
        convList.appendChild(card);
      });
    } catch (e) { convList.appendChild(el('div', 'alert error', esc(e.message))); }
  };
  convPanel.appendChild(convList);
  v.appendChild(convPanel);
  loadConvs();

  // Thread overlay
  const openThread = async (id) => {
    const overlay = el('div', '');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100;display:flex;align-items:center;justify-content:center';
    const box = el('div', 'panel');
    box.style.cssText = 'width:min(640px,92vw);max-height:80vh;display:flex;flex-direction:column;background:#fff;border-radius:14px;padding:20px';
    const head = el('div', '');
    head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px';
    head.appendChild(el('h3', '', 'Chat'));
    const close = el('button', 'btn sm secondary', '✕');
    close.onclick = () => overlay.remove();
    head.appendChild(close);
    box.appendChild(head);
    const msgs = el('div', '');
    msgs.style.cssText = 'flex:1;overflow-y:auto;min-height:280px;max-height:50vh;padding:8px 0';
    box.appendChild(msgs);
    const form = el('form', '');
    form.style.cssText = 'display:flex;gap:8px;margin-top:12px';
    const input = el('input', '', ''); input.placeholder = 'Type a message…'; input.style.flex = '1';
    const send = el('button', 'btn', 'Send'); send.type = 'submit';
    form.appendChild(input); form.appendChild(send);
    box.appendChild(form);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const loadMsgs = async () => {
      try {
        const { messages } = await api(`/chat/conversations/${id}/messages`);
        msgs.innerHTML = '';
        messages.forEach(m => {
          const mine = m.sender_id === state.admin.user_id;
          const row = el('div', '');
          row.style.cssText = `display:flex;justify-content:${mine ? 'flex-end' : 'flex-start'};margin-bottom:8px`;
          const bubble = el('div', '');
          bubble.style.cssText = `max-width:75%;padding:9px 13px;border-radius:12px;background:${mine ? '#111' : '#f1f1f1'};color:${mine ? '#fff' : '#111'}`;
          bubble.appendChild(el('div', '', esc(m.body)));
          bubble.appendChild(el('div', 'muted', `${esc(m.sender_name)} · ${fmtDT(m.created_at)}`));
          if (mine) bubble.querySelector('div:last-child').style.color = '#aaa';
          row.appendChild(bubble);
          msgs.appendChild(row);
        });
        msgs.scrollTop = msgs.scrollHeight;
        api(`/chat/conversations/${id}/read`, { method: 'POST' }).catch(() => {});
      } catch (e) { msgs.appendChild(el('div', 'alert error', esc(e.message))); }
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      try {
        await api(`/chat/conversations/${id}/messages`, { method: 'POST', body: JSON.stringify({ body: text }) });
        loadMsgs();
      } catch (ex) { toast(ex.message); }
    };
    await loadMsgs();
  };

  return v;
}

// Boot
(async function boot() {
  if (state.token) {
    try {
      const me = await api('/auth/me');
      state.admin = me.admin;
    } catch (e) { state.token = null; localStorage.removeItem('pandox_admin_token'); }
  }
  render();
})();
