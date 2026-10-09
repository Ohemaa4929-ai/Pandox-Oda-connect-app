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
  const titles = { dashboard: 'Dashboard', reports: 'Reports', users: 'Users', providers: 'Providers', verifications: 'ID Verification', listings: 'Listings', bookings: 'Bookings', disputes: 'Disputes', transactions: 'Payments & Transactions', refunds: 'Refunds', subscriptions: 'Subscriptions', commissions: 'Commissions', controls: 'Platform Control Center', settings: 'Platform Settings', policies: 'Policies', campaigns: 'Notifications', staff: 'Admin Staff', audit: 'Audit Log', sessions: 'Sessions' };
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
      ['Pending approvals', stats.pending_approvals, 'verifications'], ['Open disputes', stats.open_disputes, 'disputes']
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
    verifications.forEach(x => {
      const tr = el('tr', '');
      tr.innerHTML = `<td>${esc(x.full_name || '—')}</td><td>${esc(x.identity_type || '—')}</td><td>${esc(x.identity_number || '—')}</td><td>${badge(x.status)}</td><td>${fmtDate(x.created_at)}</td>`;
      const act = el('td', '');
      if (x.status === 'PENDING') {
        const a = el('button', 'btn sm', 'Approve');
        a.onclick = async () => { await api(`/verifications/${x.id}/review`, { method: 'POST', body: JSON.stringify({ action: 'APPROVED' }) }); toast('Approved'); load(); };
        const r = el('button', 'btn sm danger', 'Reject');
        r.onclick = async () => { await api(`/verifications/${x.id}/review`, { method: 'POST', body: JSON.stringify({ action: 'REJECTED' }) }); toast('Rejected'); load(); };
        act.appendChild(a); act.appendChild(r);
      }
      tr.appendChild(act);
      tbody.appendChild(tr);
    });
  };
  const t = el('table', 'table');
  t.innerHTML = '<thead><tr><th>Name</th><th>ID type</th><th>ID number</th><th>Status</th><th>Submitted</th><th></th></tr></thead>';
  t.appendChild(tbody);
  v.appendChild(t);
  load();
  return v;
}

/* ---------------- LISTINGS ---------------- */
async function listingsView() {
  const v = el('div');
  const panel = el('div', 'panel');
  const row = el('div', 'form-row');
  const st = el('select', '', ''); ['', 'PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'].forEach(o => { const op = el('option', '', o || 'All statuses'); op.value = o; st.appendChild(op); });
  const b = el('button', 'btn', 'Filter');
  row.appendChild(st); row.appendChild(b);
  panel.appendChild(row);
  v.appendChild(panel);
  const tbody = el('tbody', '');
  const load = async () => {
    const params = new URLSearchParams();
    if (st.value) params.set('status', st.value);
    const { listings } = await api(`/listings?${params}`);
    tbody.innerHTML = '';
    listings.forEach(l => {
      const tr = el('tr', '');
      tr.innerHTML = `<td>${esc(l.title)}</td><td>${esc(l.category)}</td><td>${esc(l.provider_name || '—')}</td><td>${badge(l.status)}</td>`;
      const act = el('td', '');
      if (l.status === 'PENDING') {
        const a = el('button', 'btn sm', 'Approve');
        a.onclick = async () => { await api(`/listings/${l.id}/review`, { method: 'POST', body: JSON.stringify({ action: 'APPROVED' }) }); toast('Approved'); load(); };
        const r = el('button', 'btn sm danger', 'Reject');
        r.onclick = async () => { await api(`/listings/${l.id}/review`, { method: 'POST', body: JSON.stringify({ action: 'REJECTED' }) }); toast('Rejected'); load(); };
        act.appendChild(a); act.appendChild(r);
      } else if (l.status === 'APPROVED') {
        const s = el('button', 'btn sm danger', 'Suspend');
        s.onclick = async () => { await api(`/listings/${l.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'SUSPENDED' }) }); toast('Suspended'); load(); };
        act.appendChild(s);
      } else if (l.status === 'SUSPENDED') {
        const r = el('button', 'btn sm', 'Restore');
        r.onclick = async () => { await api(`/listings/${l.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'APPROVED' }) }); toast('Restored'); load(); };
        act.appendChild(r);
      }
      tr.appendChild(act);
      tbody.appendChild(tr);
    });
  };
  b.onclick = load;
  const t = el('table', 'table');
  t.innerHTML = '<thead><tr><th>Title</th><th>Category</th><th>Provider</th><th>Status</th><th></th></tr></thead>';
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
      tr.innerHTML = `<td>${esc(b.booking_ref)}</td><td>${esc(b.category)}</td><td>${esc(b.customer_name || '—')}</td><td>${badge(b.status)}</td><td>${fmtGHS(b.amount)}</td><td>${fmtDate(b.created_at)}</td>`;
      tbody.appendChild(tr);
    });
  };
  const t = el('table', 'table');
  t.innerHTML = '<thead><tr><th>Ref</th><th>Category</th><th>Customer</th><th>Status</th><th>Amount</th><th>Date</th></tr></thead>';
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
      tr.innerHTML = `<td>${esc(d.reference || d.id)}</td><td>${esc(d.category)}</td><td>${esc(d.user_name || '—')}</td><td>${badge(d.status)}</td><td>${fmtDate(d.created_at)}</td>`;
      const act = el('td', '');
      if (d.status === 'OPEN') {
        const r = el('button', 'btn sm', 'Resolve');
        r.onclick = async () => { const note = prompt('Resolution note:'); await api(`/disputes/${d.id}/resolve`, { method: 'POST', body: JSON.stringify({ note }) }); toast('Resolved'); load(); };
        act.appendChild(r);
      }
      tr.appendChild(act);
      tbody.appendChild(tr);
    });
  };
  const t = el('table', 'table');
  t.innerHTML = '<thead><tr><th>Ref</th><th>Category</th><th>User</th><th>Status</th><th>Date</th><th></th></tr></thead>';
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
      tr.innerHTML = `<td>${esc(tx.txn_ref)}</td><td>${esc(tx.type)}</td><td>${fmtGHS(tx.amount)}</td><td>${fmtGHS(tx.platform_fee)}</td><td>${badge(tx.status)}</td><td>${fmtDate(tx.created_at)}</td>`;
      tbody.appendChild(tr);
    });
  };
  const t = el('table', 'table');
  t.innerHTML = '<thead><tr><th>Ref</th><th>Type</th><th>Amount</th><th>Fee</th><th>Status</th><th>Date</th></tr></thead>';
  t.appendChild(tbody);
  v.appendChild(t);
  load();
  return v;
}

/* ---------------- REFUNDS ---------------- */
async function refundsView() {
  const v = el('div');
  const tbody = el('tbody', '');
  const load = async () => {
    const { refunds } = await api('/refunds');
    tbody.innerHTML = '';
    refunds.forEach(r => {
      const tr = el('tr', '');
      tr.innerHTML = `<td>${esc(r.refund_ref || r.id)}</td><td>${fmtGHS(r.amount)}</td><td>${badge(r.status)}</td><td>${fmtDate(r.created_at)}</td>`;
      const act = el('td', '');
      if (r.status === 'REQUESTED') {
        const a = el('button', 'btn sm', 'Approve');
        a.onclick = async () => { await api(`/refunds/${r.id}/review`, { method: 'POST', body: JSON.stringify({ action: 'APPROVED' }) }); toast('Approved'); load(); };
        const d = el('button', 'btn sm danger', 'Decline');
        d.onclick = async () => { await api(`/refunds/${r.id}/review`, { method: 'POST', body: JSON.stringify({ action: 'REJECTED' }) }); toast('Declined'); load(); };
        act.appendChild(a); act.appendChild(d);
      }
      tr.appendChild(act);
      tbody.appendChild(tr);
    });
  };
  const t = el('table', 'table');
  t.innerHTML = '<thead><tr><th>Ref</th><th>Amount</th><th>Status</th><th>Date</th><th></th></tr></thead>';
  t.appendChild(tbody);
  v.appendChild(t);
  load();
  return v;
}

/* ---------------- SUBSCRIPTIONS ---------------- */
async function subscriptionsView() {
  const v = el('div');
  const tbody = el('tbody', '');
  const load = async () => {
    const { subscriptions } = await api('/subscriptions');
    tbody.innerHTML = '';
    subscriptions.forEach(s => {
      const tr = el('tr', '');
      tr.innerHTML = `<td>${esc(s.provider_name || '—')}</td><td>${esc(s.plan)}</td><td>${badge(s.status)}</td><td>${fmtDate(s.renews_at)}</td>`;
      tbody.appendChild(tr);
    });
  };
  const t = el('table', 'table');
  t.innerHTML = '<thead><tr><th>Provider</th><th>Plan</th><th>Status</th><th>Renews</th></tr></thead>';
  t.appendChild(tbody);
  v.appendChild(t);
  load();
  return v;
}

/* ---------------- COMMISSIONS ---------------- */
async function commissionsView() {
  const v = el('div');
  const tbody = el('tbody', '');
  const load = async () => {
    const { commissions } = await api('/commissions');
    tbody.innerHTML = '';
    commissions.forEach(c => {
      const tr = el('tr', '');
      tr.innerHTML = `<td>${esc(c.category)}</td><td>${c.rate}%</td><td>${badge(c.status || 'ACTIVE')}</td>`;
      tbody.appendChild(tr);
    });
  };
  const t = el('table', 'table');
  t.innerHTML = '<thead><tr><th>Category</th><th>Rate</th><th>Status</th></tr></thead>';
  t.appendChild(tbody);
  v.appendChild(t);
  load();
  return v;
}

/* ---------------- CONTROLS ---------------- */
async function controlsView() {
  const v = el('div');
  const { settings } = await api('/settings');
  const grid = el('div', 'controls-grid');
  const items = [
    ['payments_enabled', 'Payments', 'Accept payments via Paystack'],
    ['email_enabled', 'Email', 'Send transactional emails'],
    ['sms_enabled', 'SMS', 'Send SMS notifications'],
    ['maps_enabled', 'Maps', 'Show maps for locations'],
    ['maintenance_mode', 'Maintenance', 'Temporarily disable the platform'],
    ['registrations_open', 'Registrations', 'Allow new user registrations']
  ];
  items.forEach(([key, name, desc]) => {
    const c = el('div', 'control-item');
    const l = el('div', '');
    l.appendChild(el('div', 'name', esc(name)));
    l.appendChild(el('div', 'desc', esc(desc)));
    const tg = el('label', 'toggle');
    const inp = el('input', '', ''); inp.type = 'checkbox'; inp.checked = settings[key] === '1' || settings[key] === 1 || settings[key] === true;
    inp.onchange = async () => { await api('/settings', { method: 'PUT', body: JSON.stringify({ [key]: inp.checked ? '1' : '0' }) }); toast(`${name} ${inp.checked ? 'enabled' : 'disabled'}`); };
    const sl = el('span', 'slider', '');
    tg.appendChild(inp); tg.appendChild(sl);
    c.appendChild(l); c.appendChild(tg);
    grid.appendChild(c);
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
    ['platform_name', 'Platform name', settings.platform_name || 'PANDOX ODA CONNECT'],
    ['support_email', 'Support email', settings.support_email || ''],
    ['support_phone', 'Support phone', settings.support_phone || ''],
    ['currency', 'Currency', settings.currency || 'GHS'],
    ['commission_rate', 'Default commission %', settings.commission_rate || '10']
  ];
  fields.forEach(([k, label, val]) => {
    const g = el('div', 'form-group');
    g.appendChild(el('label', '', label));
    const inp = el('input', '', ''); inp.name = k; inp.value = val;
    g.appendChild(inp);
    f.appendChild(g);
  });
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
  const tbody = el('tbody', '');
  const load = async () => {
    const { policies } = await api('/policies');
    tbody.innerHTML = '';
    policies.forEach(p => {
      const tr = el('tr', '');
      tr.innerHTML = `<td>${esc(p.title)}</td><td>${esc(p.slug)}</td><td>${badge(p.status || 'ACTIVE')}</td>`;
      tbody.appendChild(tr);
    });
  };
  const t = el('table', 'table');
  t.innerHTML = '<thead><tr><th>Title</th><th>Slug</th><th>Status</th></tr></thead>';
  t.appendChild(tbody);
  v.appendChild(t);
  load();
  return v;
}

/* ---------------- CAMPAIGNS ---------------- */
async function campaignsView() {
  const v = el('div');
  const panel = el('div', 'panel');
  panel.appendChild(el('h3', '', 'Send notification'));
  const f = el('form', '');
  const g1 = el('div', 'form-group'); g1.appendChild(el('label', '', 'Title')); const title = el('input', '', ''); title.name = 'title'; g1.appendChild(title);
  const g2 = el('div', 'form-group'); g2.appendChild(el('label', '', 'Message')); const msg = el('textarea', '', ''); msg.name = 'message'; msg.rows = 3; g2.appendChild(msg);
  const g3 = el('div', 'form-group'); g3.appendChild(el('label', '', 'Audience')); const aud = el('select', '', ''); ['all', 'customers', 'providers'].forEach(o => { const op = el('option', '', o); op.value = o; aud.appendChild(op); }); aud.name = 'audience'; g3.appendChild(aud);
  const b = el('button', 'btn', 'Send'); b.type = 'submit';
  f.appendChild(g1); f.appendChild(g2); f.appendChild(g3); f.appendChild(b);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(f).entries());
    await api('/campaigns', { method: 'POST', body: JSON.stringify(body) });
    toast('Notification sent');
  };
  panel.appendChild(f);
  v.appendChild(panel);
  return v;
}

/* ---------------- STAFF ---------------- */
async function staffView() {
  const v = el('div');
  const tbody = el('tbody', '');
  const load = async () => {
    const { staff } = await api('/staff');
    tbody.innerHTML = '';
    staff.forEach(s => {
      const tr = el('tr', '');
      tr.innerHTML = `<td>${esc(s.full_name || s.email)}</td><td>${esc(s.email)}</td><td>${badge(s.role)}</td><td>${badge(s.status || 'ACTIVE')}</td>`;
      tbody.appendChild(tr);
    });
  };
  const t = el('table', 'table');
  t.innerHTML = '<thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead>';
  t.appendChild(tbody);
  v.appendChild(t);
  load();
  return v;
}

/* ---------------- AUDIT ---------------- */
async function auditView() {
  const v = el('div');
  const tbody = el('tbody', '');
  const load = async () => {
    const { logs } = await api('/audit');
    tbody.innerHTML = '';
    logs.forEach(l => {
      const tr = el('tr', '');
      tr.innerHTML = `<td>${fmtDT(l.created_at)}</td><td>${esc(l.admin_email || '—')}</td><td>${esc(l.action)}</td><td>${esc(l.details || '')}</td>`;
      tbody.appendChild(tr);
    });
  };
  const t = el('table', 'table');
  t.innerHTML = '<thead><tr><th>Time</th><th>Admin</th><th>Action</th><th>Details</th></tr></thead>';
  t.appendChild(tbody);
  v.appendChild(t);
  load();
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
      tr.innerHTML = `<td>${esc(s.admin_email || '—')}</td><td>${fmtDT(s.created_at)}</td><td>${fmtDT(s.expires_at)}</td><td>${badge(s.status || 'ACTIVE')}</td>`;
      tbody.appendChild(tr);
    });
  };
  const t = el('table', 'table');
  t.innerHTML = '<thead><tr><th>Admin</th><th>Created</th><th>Expires</th><th>Status</th></tr></thead>';
  t.appendChild(tbody);
  v.appendChild(t);
  load();
  return v;
}

/* ---------------- REPORTS ---------------- */
async function reportsView() {
  const v = el('div');
  try {
    const { report } = await api('/reports');
    const cards = el('div', 'grid grid-3', '');
    cards.style.marginBottom = '16px';
    cards.appendChild(el('div', 'card', `<h3>Total revenue</h3><p style="font-size:22px;font-weight:700">${fmtGHS(report.total_revenue)}</p>`));
    cards.appendChild(el('div', 'card', `<h3>Total bookings</h3><p style="font-size:22px;font-weight:700">${report.total_bookings}</p>`));
    cards.appendChild(el('div', 'card', `<h3>Total users</h3><p style="font-size:22px;font-weight:700">${report.total_users}</p>`));
    v.appendChild(cards);
    if (report.by_category && report.by_category.length) {
      const t = el('table', 'table');
      t.innerHTML = '<thead><tr><th>Category</th><th>Bookings</th><th>Revenue</th></tr></thead>';
      const tb = el('tbody', '');
      report.by_category.forEach(c => {
        const tr = el('tr', '');
        tr.innerHTML = `<td>${esc(c.category)}</td><td>${c.count}</td><td>${fmtGHS(c.revenue)}</td>`;
        tb.appendChild(tr);
      });
      t.appendChild(tb);
      v.appendChild(t);
    }
  } catch (e) { v.appendChild(el('div', 'alert error', esc(e.message))); }
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