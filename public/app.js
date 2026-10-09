'use strict';
/* PANDOX ODA CONNECT — customer/provider app (vanilla SPA) */
const API = '/api';
const state = { user: null, token: localStorage.getItem('pandox_token'), view: 'home', params: {}, prev: null, provider: null, catalog: [], categories: [] };

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtGHS = (n) => `GH₵ ${Number(n || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const toast = (msg) => { const t = el('div', 'toast', esc(msg)); document.body.appendChild(t); setTimeout(() => t.remove(), 3500); };

function mountAsync(parent, loader) {
  const loading = el('div', 'muted', 'Loading…');
  parent.appendChild(loading);
  Promise.resolve().then(loader).then(node => { if (node) loading.replaceWith(node); })
    .catch(err => loading.replaceWith(el('div', 'alert error', esc(err.message || 'Unable to load this section.'))));
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (!(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  const res = await fetch(API + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) { state.token = null; localStorage.removeItem('pandox_token'); state.user = null; render(); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const CATEGORY_META = {
  ride: { icon: '🚗', label: 'Transportation / Rides' },
  delivery: { icon: '📦', label: 'Delivery' },
  hotel: { icon: '🏨', label: 'Hotels' },
  short_stay: { icon: '🏡', label: 'Airbnb / Short-stay' },
  apartment: { icon: '🏢', label: 'Apartments' },
  property: { icon: '🏠', label: 'Property / Rentals' },
  other: { icon: '✨', label: 'Other services' }
};
const STATUS_BADGE = { APPROVED: 'green', PENDING: 'amber', PENDING_VERIFICATION: 'amber', REJECTED: 'red', SUSPENDED: 'red', ACTIVE: 'green', COMPLETED: 'green', CONFIRMED: 'green', IN_PROGRESS: 'blue', CANCELLED: 'red', PAID: 'green', EXPIRED: 'red', UNDER_REVIEW: 'amber' };
const badge = (s) => `<span class="badge ${STATUS_BADGE[s] || 'gray'}">${esc(s)}</span>`;

/* ---------------- NAV ---------------- */
function nav() {
  const links = [
    ['home', 'Home'], ['rides', 'Rides'], ['delivery', 'Delivery'], ['hotels', 'Hotels'],
    ['short_stay', 'Short-stay'], ['apartments', 'Apartments']
  ];
  const n = el('nav', 'nav');
  const inner = el('div', 'nav-inner');
  inner.appendChild(el('a', 'logo', `<span class="dot"></span> PANDOX ODA CONNECT`));
  const lk = el('div', 'nav-links');
  links.forEach(([v, label]) => { const a = el('a', state.view === v ? 'active' : '', esc(label)); a.href = '#'; a.onclick = (e) => { e.preventDefault(); go(v); }; lk.appendChild(a); });
  inner.appendChild(lk);
  const u = el('div', 'nav-user');
  if (state.user) {
    const av = el('div', 'avatar', esc((state.user.full_name || 'U')[0].toUpperCase()));
    const menu = el('div');
    const name = el('a', '', esc(state.user.full_name || state.user.email));
    name.href = '#'; name.onclick = (e) => { e.preventDefault(); go('account'); };
    menu.appendChild(name);
    if (state.provider) {
      const pd = el('a', '', ' · Provider panel');
      pd.href = '#'; pd.onclick = (e) => { e.preventDefault(); go('provider'); };
      menu.appendChild(pd);
    }
    const msg = el('a', '', ' · Messages');
    msg.href = '#'; msg.onclick = (e) => { e.preventDefault(); go('chat'); };
    menu.appendChild(msg);
    const out = el('a', '', ' · Logout');
    out.href = '#'; out.onclick = async (e) => { e.preventDefault(); await api('/auth/logout', { method: 'POST' }).catch(() => {}); state.token = null; localStorage.removeItem('pandox_token'); state.user = null; state.provider = null; go('home'); };
    menu.appendChild(out);
    u.appendChild(av); u.appendChild(menu);
  } else {
    const login = el('button', 'btn sm', 'Login');
    login.onclick = () => go('login');
    const reg = el('button', 'btn sm accent', 'Register');
    reg.onclick = () => go('register');
    u.appendChild(login); u.appendChild(reg);
  }
  inner.appendChild(u);
  n.appendChild(inner);
  return n;
}

/* ---------------- VIEWS ---------------- */
const CAT_VIEWS = { rides: 'ride', delivery: 'delivery', hotels: 'hotel', short_stay: 'short_stay', apartments: 'apartment' };
function go(view, params = {}) {
  state.prev = { view: state.view, params: { ...state.params } };
  state.view = view; state.params = params;
  if (CAT_VIEWS[view]) { state.params = { category: CAT_VIEWS[view] }; loadCatalog(); return; }
  if (view === 'account' || view === 'provider' || view === 'bookings' || view === 'disputes') loadUser();
  else if (view === 'home' && (params.q || params.category)) loadCatalog();
  else render();
}

function backBtn(label = 'Back') {
  const b = el('button', 'btn outline sm', `← ${label}`);
  b.onclick = () => {
    if (state.prev) go(state.prev.view, state.prev.params);
    else go('home');
  };
  b.style.marginBottom = '16px';
  return b;
}

async function loadUser() {
  if (!state.token) { go('login'); return; }
  try {
    const me = await api('/auth/me');
    state.user = me.user;
    const prov = await api('/provider/me').catch(() => null);
    state.provider = prov ? prov.provider : null;
  } catch (e) { state.user = null; }
  render();
}

async function loadCatalog() {
  try {
    const q = state.params.q || '';
    const cat = state.params.category || '';
    const url = `/catalog?${new URLSearchParams({ q, category: cat })}`;
    state.catalog = (await api(url)).listings;
  } catch (e) { state.catalog = []; }
  render();
}

function homeView() {
  const v = el('div');
  const hero = el('div', 'hero');
  hero.appendChild(el('h1', '', 'Everything in Akim Oda. One platform.'));
  hero.appendChild(el('p', '', 'Book rides, send deliveries, find hotels, short-stay and apartments — all verified, all in one place.'));
  const search = el('div', 'search');
  const input = el('input', '', ''); input.placeholder = 'Search services, hotels, apartments…';
  const btn = el('button', 'btn', 'Search');
  btn.onclick = () => { state.params = { q: input.value }; loadCatalog(); };
  search.appendChild(input); search.appendChild(btn);
  hero.appendChild(search);
  v.appendChild(hero);
  v.appendChild(el('h2', 'section-title', 'Browse services'));
  const grid = el('div', 'grid grid-4');
  Object.entries(CATEGORY_META).forEach(([k, m]) => {
    const c = el('div', 'cat-card');
    c.onclick = () => go(k === 'ride' ? 'rides' : k === 'delivery' ? 'delivery' : k === 'hotel' ? 'hotels' : k === 'short_stay' ? 'short_stay' : 'apartments');
    c.appendChild(el('div', 'icon', m.icon));
    c.appendChild(el('h3', '', esc(m.label)));
    c.appendChild(el('p', '', 'Browse and book'));
    grid.appendChild(c);
  });
  v.appendChild(grid);
  if (state.catalog.length) {
    v.appendChild(el('h2', 'section-title', 'Featured listings'));
    v.appendChild(listingsGrid(state.catalog));
  }
  return v;
}

function listingsGrid(listings) {
  const grid = el('div', 'grid grid-3');
  listings.forEach(l => {
    const card = el('div', 'listing-card');
    card.onclick = () => go('listing', { id: l.id });
    card.appendChild(el('div', 'img', CATEGORY_META[l.category]?.icon || '🏷️'));
    const body = el('div', 'body');
    body.appendChild(el('h4', '', esc(l.title)));
    body.appendChild(el('div', 'price', l.price_per_night ? `${fmtGHS(l.price_per_night)}/night` : l.price_per_month ? `${fmtGHS(l.price_per_month)}/month` : 'Contact for price'));
    body.appendChild(el('div', 'meta', `${esc(l.location || l.city || 'Akim Oda')} · ${badge(l.status)}`));
    card.appendChild(body);
    grid.appendChild(card);
  });
  return grid;
}

function categoryView(category) {
  const v = el('div');
  v.appendChild(backBtn());
  v.appendChild(el('h1', '', esc(CATEGORY_META[category]?.label || category)));
  const search = el('div', 'search', ''); search.style.margin = '16px 0';
  const input = el('input', '', ''); input.placeholder = `Search ${category}…`;
  const btn = el('button', 'btn', 'Search');
  btn.onclick = async () => { state.catalog = (await api(`/catalog?category=${category}&q=${encodeURIComponent(input.value)}`)).listings; render(); };
  search.appendChild(input); search.appendChild(btn);
  v.appendChild(search);
  if (state.catalog.length) v.appendChild(listingsGrid(state.catalog));
  else v.appendChild(el('div', 'empty', '<div class="icon">🔍</div>No listings yet. Check back soon.'));
  return v;
}

async function resultsView() {
  const v = el('div', '');
  v.appendChild(backBtn());
  v.appendChild(el('h2', '', 'Search results'));
  const list = el('div', 'list');
  if (!state.catalog.length) list.appendChild(el('p', 'muted', 'No results found.'));
  for (const l of state.catalog) {
    const card = el('div', 'card listing-card');
    card.onclick = () => go('listing', { id: l.id });
    card.appendChild(el('h3', '', esc(l.title)));
    if (l.description) card.appendChild(el('p', 'muted', esc(l.description)));
    card.appendChild(el('p', 'price', fmtGHS(l.price)));
    list.appendChild(card);
  }
  v.appendChild(list);
  return v;
}

async function listingView() {
  const v = el('div');
  v.appendChild(backBtn());
  try {
    const { listing, rooms } = await api(`/catalog/listings/${state.params.id}`);
    v.appendChild(el('h1', '', esc(listing.title)));
    v.appendChild(el('p', 'muted', `${esc(listing.location || listing.city || 'Akim Oda')} · ${badge(listing.status)}`));
    v.appendChild(el('p', '', esc(listing.description || '')));
    const price = el('div', 'card', '');
    price.style.margin = '16px 0';
    price.appendChild(el('h3', '', listing.price_per_night ? `From ${fmtGHS(listing.price_per_night)} / night` : listing.price_per_month ? `${fmtGHS(listing.price_per_month)} / month` : 'Contact provider'));
    if (rooms && rooms.length) {
      price.appendChild(el('h4', '', 'Rooms'));
      rooms.forEach(r => price.appendChild(el('p', '', `${esc(r.name)} — ${fmtGHS(r.price_per_night)}/night`)));
    }
    v.appendChild(price);
    if (listing.media && listing.media.length) {
      const mediaCard = el('div', 'card', '');
      mediaCard.appendChild(el('h3', '', 'Photos and video'));
      const mediaGrid = el('div', 'media-grid');
      listing.media.forEach(m => {
        if (m.media_type === 'video') {
          const video = document.createElement('video');
          video.controls = true; video.preload = 'metadata'; video.src = m.file_path; video.className = 'listing-media';
          mediaGrid.appendChild(video);
        } else {
          const img = document.createElement('img');
          img.src = m.file_path; img.alt = m.original_name || listing.title; img.loading = 'lazy'; img.className = 'listing-media';
          mediaGrid.appendChild(img);
        }
      });
      mediaCard.appendChild(mediaGrid);
      v.appendChild(mediaCard);
    }
    if (listing.provider) {
      const p = el('div', 'card', '');
      p.appendChild(el('h4', '', esc(listing.provider.business_name || 'Provider')));
      p.appendChild(el('p', 'muted', `${esc(listing.provider.provider_type)} · ${esc(listing.provider.phone || '')}`));
      v.appendChild(p);
    }
    if (state.user && listing.provider && listing.provider.id) {
      const msg = el('button', 'btn outline', '💬 Message provider');
      msg.style.marginRight = '8px';
      msg.onclick = async () => {
        try {
          const { conversation } = await api('/chat/conversations', { method: 'POST', body: JSON.stringify({ user_id: listing.provider.user_id }) });
          go('chat-thread', { id: conversation.id });
        } catch (ex) { toast(ex.message); }
      };
      v.appendChild(msg);
    }
    if (state.user) {
      const book = el('button', 'btn', 'Book now');
      book.onclick = () => go('book', { listing });
      v.appendChild(book);
    } else {
      const l = el('button', 'btn', 'Login to book');
      l.onclick = () => go('login');
      v.appendChild(l);
    }
  } catch (e) { v.appendChild(el('div', 'alert error', esc(e.message))); }
  return v;
}

function authView(mode) {
  const v = el('div', 'container');
  const card = el('div', 'card form-card');
  card.appendChild(el('h2', '', mode === 'login' ? 'Welcome back' : 'Create your account'));
  const err = el('div', 'alert error', ''); err.style.display = 'none';
  card.appendChild(err);
  const f = el('form', '');
  if (mode === 'register') {
    f.appendChild(field('Full name', 'full_name', 'text', 'Your full name'));
    f.appendChild(field('Phone', 'phone', 'tel', 'e.g. 0244 000 000'));
  }
  f.appendChild(field('Email', 'email', 'email', 'you@example.com'));
  f.appendChild(field('Password', 'password', 'password', 'At least 8 characters'));
  if (mode === 'register') {
    f.appendChild(field('Register as provider?', 'provider_type', 'select', '', ['', 'driver', 'delivery', 'hotel', 'short_stay', 'apartment', 'property']));
    f.appendChild(field('Business name (providers)', 'business_name', 'text', 'Your business name'));
  }
  const btn = el('button', 'btn', mode === 'login' ? 'Login' : 'Create account');
  btn.type = 'submit'; btn.style.width = '100%';
  f.appendChild(btn);
  f.onsubmit = async (e) => {
    e.preventDefault();
    err.style.display = 'none';
    const body = Object.fromEntries(new FormData(f).entries());
    try {
      if (mode === 'login') {
        const data = await api('/auth/login', { method: 'POST', body: JSON.stringify(body) });
        state.token = data.token; localStorage.setItem('pandox_token', data.token);
        state.user = data.user;
        toast('Welcome back!');
        go('home');
      } else {
        const data = await api('/auth/register', { method: 'POST', body: JSON.stringify(body) });
        state.token = data.token; localStorage.setItem('pandox_token', data.token);
        state.user = data.user;
        toast('Account created!');
        go('home');
      }
    } catch (ex) { err.textContent = ex.message; err.style.display = 'block'; }
  };
  card.appendChild(f);
  const alt = el('p', 'muted', mode === 'login' ? 'New here? ' : 'Have an account? ');
  const a = el('a', '', mode === 'login' ? 'Create an account' : 'Login');
  a.href = '#'; a.onclick = (e) => { e.preventDefault(); go(mode === 'login' ? 'register' : 'login'); };
  alt.appendChild(a);
  card.appendChild(alt);
  v.appendChild(card);
  return v;
}

function field(label, name, type, placeholder, options) {
  const g = el('div', 'form-group');
  g.appendChild(el('label', '', esc(label)));
  let input;
  if (type === 'select') {
    input = el('select', '', '');
    input.name = name;
    const labels = { '': 'Customer (no provider account)', driver: 'Driver', delivery: 'Delivery provider', hotel: 'Hotel', short_stay: 'Airbnb / Short-stay operator', apartment: 'Apartment provider', property: 'Property provider' };
    (options || []).forEach(o => { const op = el('option', '', esc(labels[o] || o)); op.value = o; input.appendChild(op); });
  } else {
    input = el('input', '', ''); input.type = type; input.name = name; input.placeholder = placeholder || '';
  }
  g.appendChild(input);
  return g;
}

function accountView() {
  const v = el('div', 'container');
  v.appendChild(backBtn());
  v.appendChild(el('h1', '', 'My account'));
  const tabs = el('div', 'tabs');
  [['profile', 'Profile'], ['bookings', 'Bookings'], ['subscription', 'Subscription'], ['disputes', 'Disputes'], ['notifications', 'Notifications'], ['policies', 'Policies']].forEach(([k, l]) => {
    const b = el('button', state.params.tab === k ? 'active' : '', esc(l));
    b.onclick = () => { state.params.tab = k; render(); };
    tabs.appendChild(b);
  });
  v.appendChild(tabs);
  const tab = state.params.tab || 'profile';
  if (tab === 'profile') v.appendChild(profileTab());
  else if (tab === 'bookings') mountAsync(v, bookingsTab);
  else if (tab === 'subscription') mountAsync(v, subscriptionTab);
  else if (tab === 'disputes') mountAsync(v, disputesTab);
  else if (tab === 'notifications') mountAsync(v, notificationsTab);
  else if (tab === 'policies') mountAsync(v, policiesTab);
  return v;
}

function profileTab() {
  const v = el('div', 'card');
  v.appendChild(el('h3', '', 'Profile'));
  const f = el('form', '');
  f.appendChild(field('Full name', 'full_name', 'text', state.user?.full_name || ''));
  f.appendChild(field('Phone', 'phone', 'tel', state.user?.phone || ''));
  const btn = el('button', 'btn', 'Save changes'); btn.type = 'submit';
  f.appendChild(btn);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(f).entries());
    await api('/user/profile', { method: 'PUT', body: JSON.stringify(body) });
    toast('Profile updated');
    loadUser();
  };
  v.appendChild(f);
  const idCard = el('div', 'card', '');
  idCard.style.marginTop = '16px';
  idCard.appendChild(el('h3', '', 'Identity verification'));
  idCard.appendChild(el('p', '', `Status: ${badge(state.user?.identity_status || 'NOT_SUBMITTED')}`));
  if (state.user?.identity_status !== 'APPROVED') {
    const form = el('form', '');
    form.appendChild(field('ID type', 'identity_type', 'select', '', ['ghana_card', 'passport', 'drivers_licence', 'other']));
    form.appendChild(field('ID number', 'identity_number', 'text', 'Your ID number (encrypted)'));
    const b = el('button', 'btn', 'Submit for verification'); b.type = 'submit';
    form.appendChild(b);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(form).entries());
      try { await api('/auth/identity', { method: 'POST', body: JSON.stringify(body) }); toast('Identity submitted for review'); loadUser(); }
      catch (ex) { toast(ex.message); }
    };
    idCard.appendChild(form);
  }
  v.appendChild(idCard);
  return v;
}

async function bookingsTab() {
  const v = el('div');
  try {
    const { bookings } = await api('/user/bookings');
    if (!bookings.length) return el('div', 'empty', '<div class="icon">📅</div>No bookings yet.');
    const t = el('table', 'table');
    t.innerHTML = '<thead><tr><th>Ref</th><th>Category</th><th>Status</th><th>Amount</th><th>Date</th><th></th></tr></thead>';
    const tb = el('tbody', '');
    bookings.forEach(b => {
      const tr = el('tr', '');
      tr.innerHTML = `<td>${esc(b.booking_ref)}</td><td>${esc(CATEGORY_META[b.category]?.label || b.category)}</td><td>${badge(b.status)}</td><td>${fmtGHS(b.amount)}</td><td>${fmtDate(b.created_at)}</td>`;
      const act = el('td', '');
      if (['PENDING', 'CONFIRMED', 'IN_PROGRESS'].includes(b.status)) {
        const c = el('button', 'btn sm danger', 'Cancel');
        c.onclick = async () => { if (confirm('Cancel this booking?')) { await api(`/bookings/${b.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: 'Customer requested' }) }); toast('Booking cancelled'); bookingsTab(); } };
        act.appendChild(c);
      }
      if (b.status === 'COMPLETED' && !b.rating) {
        const r = el('button', 'btn sm', 'Rate');
        r.onclick = () => go('rate', { booking: b });
        act.appendChild(r);
      }
      tr.appendChild(act);
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    v.appendChild(t);
  } catch (e) { v.appendChild(el('div', 'alert error', esc(e.message))); }
  return v;
}

async function subscriptionTab() {
  const v = el('div');
  try {
    const { subscription, customer_plan, provider_plan } = await api('/payments/subscriptions/me');
    const card = el('div', 'card', '');
    card.appendChild(el('h3', '', 'My subscription'));
    if (subscription) {
      card.appendChild(el('p', '', `Plan: <strong>${esc(subscription.plan_name || '')}</strong> · Status: ${badge(subscription.status)}`));
      card.appendChild(el('p', 'muted', `Started ${fmtDate(subscription.starts_at)} · Expires ${fmtDate(subscription.expires_at)}`));
    } else {
      card.appendChild(el('p', '', 'You have no active subscription.'));
    }
    v.appendChild(card);
    const plans = el('div', 'grid grid-2', '');
    plans.style.marginTop = '16px';
    [customer_plan, provider_plan].filter(Boolean).forEach(p => {
      const c = el('div', 'card', '');
      c.appendChild(el('h3', '', esc(p.name)));
      c.appendChild(el('p', '', `${fmtGHS(p.price)} / ${p.billing_period_days} days`));
      if (p.trial_days) c.appendChild(el('p', 'muted', `${p.trial_days}-day trial`));
      const b = el('button', 'btn', 'Subscribe');
      b.onclick = async () => {
        try {
          const r = await api('/payments/subscriptions/subscribe', { method: 'POST', body: JSON.stringify({ audience: p.audience }) });
          if (r.payment && r.payment.authorization_url) { window.location.href = r.payment.authorization_url; }
          else if (r.activated) { toast('Subscription active'); loadUser(); }
        } catch (ex) { toast(ex.message); }
      };
      c.appendChild(b);
      plans.appendChild(c);
    });
    v.appendChild(plans);
  } catch (e) { v.appendChild(el('div', 'alert error', esc(e.message))); }
  return v;
}

async function disputesTab() {
  const v = el('div');
  const newBtn = el('button', 'btn', '+ Open a dispute');
  newBtn.onclick = () => go('new-dispute');
  v.appendChild(newBtn);
  try {
    const { disputes } = await api('/disputes/mine');
    if (!disputes.length) { v.appendChild(el('div', 'empty', '<div class="icon">⚖️</div>No disputes.')); return v; }
    const t = el('table', 'table');
    t.innerHTML = '<thead><tr><th>Ref</th><th>Category</th><th>Status</th><th>Date</th></tr></thead>';
    const tb = el('tbody', '');
    disputes.forEach(d => {
      const tr = el('tr', '');
      tr.innerHTML = `<td>${esc(d.dispute_ref)}</td><td>${esc(d.category)}</td><td>${badge(d.status)}</td><td>${fmtDate(d.created_at)}</td>`;
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    v.appendChild(t);
  } catch (e) { v.appendChild(el('div', 'alert error', esc(e.message))); }
  return v;
}

async function notificationsTab() {
  const v = el('div');
  try {
    const { notifications } = await api('/user/notifications');
    if (!notifications.length) return el('div', 'empty', '<div class="icon">🔔</div>No notifications.');
    notifications.forEach(n => {
      const c = el('div', 'card', '');
      c.style.marginBottom = '10px';
      c.appendChild(el('p', '', `<strong>${esc(n.title)}</strong> ${n.read ? '' : badge('NEW')}`));
      c.appendChild(el('p', 'muted', esc(n.body)));
      c.appendChild(el('p', 'muted', fmtDate(n.created_at)));
      v.appendChild(c);
    });
  } catch (e) { v.appendChild(el('div', 'alert error', esc(e.message))); }
  return v;
}

async function policiesTab() {
  const v = el('div');
  try {
    const { policies } = await api('/user/policies');
    const { accepted } = await api('/user/policies/accepted');
    const acceptedIds = new Set(accepted.map(a => a.policy_id));
    policies.forEach(p => {
      const c = el('div', 'card', '');
      c.style.marginBottom = '10px';
      c.appendChild(el('p', '', `<strong>${esc(p.title)}</strong> v${p.version} ${acceptedIds.has(p.id) ? badge('ACCEPTED') : ''}`));
      const b = el('button', 'btn sm', acceptedIds.has(p.id) ? 'View' : 'Accept');
      b.onclick = async () => {
        if (!acceptedIds.has(p.id)) { await api('/user/policies/accept', { method: 'POST', body: JSON.stringify({ policy_id: p.id }) }); toast('Policy accepted'); policiesTab(); }
        else { const { policy } = await api(`/user/policies/${p.slug}`); alert(policy.content); }
      };
      c.appendChild(b);
      v.appendChild(c);
    });
  } catch (e) { v.appendChild(el('div', 'alert error', esc(e.message))); }
  return v;
}

function bookView() {
  const l = state.params.listing;
  const v = el('div', 'container');
  v.appendChild(backBtn());
  const card = el('div', 'card form-card');
  card.appendChild(el('h2', '', `Book: ${esc(l.title)}`));
  const f = el('form', '');
  if (['hotel', 'short_stay'].includes(l.category)) {
    f.appendChild(field('Check-in', 'check_in', 'date', ''));
    f.appendChild(field('Check-out', 'check_out', 'date', ''));
  } else if (l.category === 'ride') {
    f.appendChild(field('Pickup location', 'pickup_location', 'text', 'Where are you?'));
    f.appendChild(field('Destination', 'destination', 'text', 'Where to?'));
  } else if (l.category === 'delivery') {
    f.appendChild(field('Pickup', 'pickup_location', 'text', 'Pickup address'));
    f.appendChild(field('Destination', 'destination', 'text', 'Delivery address'));
    f.appendChild(field('Package info', 'package_info', 'text', 'What are you sending?'));
  }
  f.appendChild(field('Notes', 'notes', 'text', 'Optional notes'));
  const b = el('button', 'btn', 'Confirm booking'); b.type = 'submit'; b.style.width = '100%';
  f.appendChild(b);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(f).entries());
    body.category = l.category;
    body.listing_id = l.id;
    try {
      const r = await api('/bookings', { method: 'POST', body: JSON.stringify(body) });
      if (r.payment && r.payment.authorization_url) { window.location.href = r.payment.authorization_url; }
      else { toast('Booking confirmed!'); go('account', { tab: 'bookings' }); }
    } catch (ex) { toast(ex.message); }
  };
  card.appendChild(f);
  v.appendChild(card);
  return v;
}

function rateView() {
  const b = state.params.booking;
  const v = el('div', 'container');
  v.appendChild(backBtn());
  const card = el('div', 'card form-card');
  card.appendChild(el('h2', '', `Rate booking ${esc(b.booking_ref)}`));
  const f = el('form', '');
  f.appendChild(field('Rating (1-5)', 'rating', 'number', '5'));
  f.appendChild(field('Review', 'review', 'text', 'How was your experience?'));
  const btn = el('button', 'btn', 'Submit rating'); btn.type = 'submit';
  f.appendChild(btn);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(f).entries());
    await api(`/bookings/${b.id}/rate`, { method: 'POST', body: JSON.stringify(body) });
    toast('Thanks for your review!');
    go('account', { tab: 'bookings' });
  };
  card.appendChild(f);
  v.appendChild(card);
  return v;
}

function newDisputeView() {
  const v = el('div', 'container');
  v.appendChild(backBtn());
  const card = el('div', 'card form-card');
  card.appendChild(el('h2', '', 'Open a dispute'));
  const f = el('form', '');
  f.appendChild(field('Category', 'category', 'select', '', ['booking', 'payment', 'service', 'refund', 'provider', 'other']));
  f.appendChild(field('Booking ID (optional)', 'booking_id', 'number', ''));
  f.appendChild(field('Description', 'description', 'text', 'What happened?'));
  const b = el('button', 'btn', 'Submit dispute'); b.type = 'submit';
  f.appendChild(b);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(f).entries());
    try { await api('/disputes', { method: 'POST', body: JSON.stringify(body) }); toast('Dispute opened'); go('account', { tab: 'disputes' }); }
    catch (ex) { toast(ex.message); }
  };
  card.appendChild(f);
  v.appendChild(card);
  return v;
}

/* ---------------- PROVIDER PANEL ---------------- */
function providerView() {
  const v = el('div', 'container');
  v.appendChild(backBtn());
  v.appendChild(el('h1', '', 'Provider panel'));
  if (!state.provider) {
    v.appendChild(el('div', 'alert info', 'You have no provider account. Register as a provider to offer services.'));
    const b = el('button', 'btn', 'Register as provider');
    b.onclick = () => go('register');
    v.appendChild(b);
    return v;
  }
  v.appendChild(el('p', '', `Status: ${badge(state.provider.status)} · Subscription: ${badge(state.provider.subscription_status || 'NONE')}`));
  if (state.provider.status !== 'APPROVED') {
    v.appendChild(el('div', 'alert info', `Your provider account is ${state.provider.status}. An administrator will review your application.`));
    return v;
  }
  const subscriptionSlot = el('div');
  v.appendChild(subscriptionSlot);
  mountAsync(subscriptionSlot, providerSubscriptionCard);
  if (state.provider.subscription_status !== 'ACTIVE') {
    v.appendChild(el('div', 'alert info', 'Subscribe to the provider package to create listings, manage bookings, and upload service or property media.'));
    return v;
  }
  const tabs = el('div', 'tabs');
  [['listings', 'Listings'], ['bookings', 'Bookings'], ['earnings', 'Earnings'], ['vehicles', 'Vehicles']].forEach(([k, l]) => {
    const b = el('button', state.params.ptab === k ? 'active' : '', esc(l));
    b.onclick = () => { state.params.ptab = k; render(); };
    tabs.appendChild(b);
  });
  v.appendChild(tabs);
  const tab = state.params.ptab || 'listings';
  if (tab === 'listings') mountAsync(v, providerListings);
  else if (tab === 'bookings') mountAsync(v, providerBookings);
  else if (tab === 'earnings') mountAsync(v, providerEarnings);
  else if (tab === 'vehicles') mountAsync(v, providerVehicles);
  return v;
}

async function providerSubscriptionCard() {
  const v = el('div', 'card');
  try {
    const { subscription, provider_plan } = await api('/payments/subscriptions/me');
    v.appendChild(el('h3', '', 'Provider subscription'));
    if (subscription && subscription.plan_name && subscription.plan_name.toLowerCase().includes('provider')) {
      v.appendChild(el('p', '', `Plan: <strong>${esc(subscription.plan_name)}</strong> · Status: ${badge(subscription.status)}`));
      v.appendChild(el('p', 'muted', `Started ${fmtDate(subscription.starts_at)} · Expires ${fmtDate(subscription.expires_at)}`));
    } else {
      v.appendChild(el('p', '', 'Your provider account is approved. Choose the available package to start offering services.'));
      if (provider_plan && provider_plan.active) {
        v.appendChild(el('p', '', `<strong>${esc(provider_plan.name)}</strong> · ${fmtGHS(provider_plan.price)} / ${provider_plan.billing_period_days} days`));
        if (provider_plan.description) v.appendChild(el('p', 'muted', esc(provider_plan.description)));
        const b = el('button', 'btn', provider_plan.price > 0 ? 'Subscribe securely' : 'Activate provider package');
        b.onclick = async () => {
          b.disabled = true;
          try {
            const r = await api('/payments/subscriptions/subscribe', { method: 'POST', body: JSON.stringify({ audience: 'provider' }) });
            if (r.payment && r.payment.authorization_url) window.location.href = r.payment.authorization_url;
            else if (r.activated) { toast('Provider subscription active'); await loadUser(); }
          } catch (e) { b.disabled = false; toast(e.message); }
        };
        v.appendChild(b);
      } else v.appendChild(el('div', 'alert info', 'Provider subscriptions are not currently available.'));
    }
  } catch (e) { v.appendChild(el('div', 'alert error', esc(e.message))); }
  return v;
}

async function providerListings() {
  const v = el('div');
  const newBtn = el('button', 'btn', '+ New listing');
  newBtn.onclick = () => go('new-listing');
  v.appendChild(newBtn);
  try {
    const { listings } = await api('/provider/listings');
    if (!listings.length) { v.appendChild(el('div', 'empty', '<div class="icon">🏷️</div>No listings yet.')); return v; }
    const t = el('table', 'table');
    t.innerHTML = '<thead><tr><th>Title</th><th>Category</th><th>Status</th><th>Price</th><th>Media</th></tr></thead>';
    const tb = el('tbody', '');
    listings.forEach(l => {
      const tr = el('tr', '');
      tr.innerHTML = `<td>${esc(l.title)}</td><td>${esc(CATEGORY_META[l.category]?.label || l.category)}</td><td>${badge(l.status)}</td><td>${l.price_per_night ? fmtGHS(l.price_per_night) + '/n' : l.price_per_month ? fmtGHS(l.price_per_month) + '/m' : '—'}</td>`;
      const mediaCell = el('td');
      mediaCell.appendChild(mediaUploadBox(l));
      tr.appendChild(mediaCell);
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    v.appendChild(t);
  } catch (e) { v.appendChild(el('div', 'alert error', esc(e.message))); }
  return v;
}

function mediaUploadBox(listing) {
  const wrap = el('div', 'media-upload');
  const form = el('form', '');
  const input = el('input', '', '');
  input.type = 'file'; input.name = 'media'; input.multiple = true;
  input.accept = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,video/x-msvideo';
  input.title = 'Choose images or videos';
  const button = el('button', 'btn sm outline', 'Upload'); button.type = 'submit';
  form.appendChild(input); form.appendChild(button);
  const hint = el('div', 'muted', 'Up to 8 files, 50 MB each');
  form.appendChild(hint);
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!input.files.length) return toast('Choose at least one image or video.');
    const data = new FormData();
    Array.from(input.files).forEach(file => data.append('media', file));
    button.disabled = true;
    try {
      const result = await api(`/provider/listings/${listing.id}/media`, { method: 'POST', body: data });
      toast(`${result.media.length} media file${result.media.length === 1 ? '' : 's'} uploaded`);
      input.value = '';
    } catch (err) { toast(err.message); }
    finally { button.disabled = false; }
  };
  wrap.appendChild(form);
  return wrap;
}

function newListingView() {
  const v = el('div', 'container');
  v.appendChild(backBtn());
  const card = el('div', 'card form-card');
  card.appendChild(el('h2', '', 'New listing'));
  const f = el('form', '');
  f.appendChild(field('Category', 'category', 'select', '', ['hotel', 'short_stay', 'apartment', 'property', 'other']));
  f.appendChild(field('Title', 'title', 'text', 'e.g. Cozy 2-bedroom apartment'));
  f.appendChild(field('Description', 'description', 'text', 'Describe your service'));
  f.appendChild(field('Location', 'location', 'text', 'e.g. Akim Oda, near the market'));
  f.appendChild(field('Price per night (hotels/short-stay)', 'price_per_night', 'number', ''));
  f.appendChild(field('Price per month (apartments)', 'price_per_month', 'number', ''));
  const b = el('button', 'btn', 'Submit listing'); b.type = 'submit';
  f.appendChild(b);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(f).entries());
    try { await api('/provider/listings', { method: 'POST', body: JSON.stringify(body) }); toast('Listing submitted'); go('provider', { ptab: 'listings' }); }
    catch (ex) { toast(ex.message); }
  };
  card.appendChild(f);
  v.appendChild(card);
  return v;
}

async function providerBookings() {
  const v = el('div');
  try {
    const { bookings } = await api('/provider/bookings');
    if (!bookings.length) { v.appendChild(el('div', 'empty', '<div class="icon">📅</div>No bookings yet.')); return v; }
    const t = el('table', 'table');
    t.innerHTML = '<thead><tr><th>Ref</th><th>Category</th><th>Status</th><th>Amount</th><th>Actions</th></tr></thead>';
    const tb = el('tbody', '');
    bookings.forEach(b => {
      const tr = el('tr', '');
      tr.innerHTML = `<td>${esc(b.booking_ref)}</td><td>${esc(CATEGORY_META[b.category]?.label || b.category)}</td><td>${badge(b.status)}</td><td>${fmtGHS(b.amount)}</td>`;
      const act = el('td', '');
      if (['ride', 'delivery'].includes(b.category) && ['PENDING', 'CONFIRMED'].includes(b.status)) {
        const a = el('button', 'btn sm', 'Accept');
        a.onclick = async () => { await api(`/provider/bookings/${b.id}/accept`, { method: 'POST' }); toast('Accepted'); providerBookings(); };
        act.appendChild(a);
      }
      if (b.category === 'delivery' && ['IN_PROGRESS', 'PICKED_UP', 'IN_TRANSIT'].includes(b.status)) {
        const s = el('button', 'btn sm', 'Mark delivered');
        s.onclick = async () => { await api(`/provider/bookings/${b.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'COMPLETED' }) }); toast('Completed'); providerBookings(); };
        act.appendChild(s);
      }
      tr.appendChild(act);
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    v.appendChild(t);
  } catch (e) { v.appendChild(el('div', 'alert error', esc(e.message))); }
  return v;
}

async function providerEarnings() {
  const v = el('div');
  try {
    const { earnings, total_provider_amount, settled } = await api('/provider/earnings');
    const cards = el('div', 'grid grid-3', '');
    cards.style.marginBottom = '16px';
    cards.appendChild(el('div', 'card', `<h3>Total earnings</h3><p style="font-size:22px;font-weight:700;color:var(--brand)">${fmtGHS(total_provider_amount)}</p>`));
    cards.appendChild(el('div', 'card', `<h3>Settled</h3><p style="font-size:22px;font-weight:700">${fmtGHS(settled)}</p>`));
    cards.appendChild(el('div', 'card', `<h3>Transactions</h3><p style="font-size:22px;font-weight:700">${earnings.length}</p>`));
    v.appendChild(cards);
    if (!earnings.length) { v.appendChild(el('div', 'empty', '<div class="icon">💰</div>No earnings yet.')); return v; }
    const t = el('table', 'table');
    t.innerHTML = '<thead><tr><th>Ref</th><th>Type</th><th>Amount</th><th>Platform fee</th><th>Your share</th><th>Status</th></tr></thead>';
    const tb = el('tbody', '');
    earnings.forEach(tx => {
      const tr = el('tr', '');
      tr.innerHTML = `<td>${esc(tx.txn_ref)}</td><td>${esc(tx.type)}</td><td>${fmtGHS(tx.amount)}</td><td>${fmtGHS(tx.platform_fee)}</td><td>${fmtGHS(tx.provider_amount)}</td><td>${badge(tx.status)}</td>`;
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    v.appendChild(t);
  } catch (e) { v.appendChild(el('div', 'alert error', esc(e.message))); }
  return v;
}

async function providerVehicles() {
  const v = el('div');
  const form = el('form', 'card', '');
  form.style.marginBottom = '16px';
  form.appendChild(el('h3', '', 'Add vehicle'));
  form.appendChild(field('Make', 'make', 'text', 'e.g. Toyota'));
  form.appendChild(field('Model', 'model', 'text', 'e.g. Corolla'));
  form.appendChild(field('Plate number', 'plate_number', 'text', 'e.g. AK-1234-24'));
  form.appendChild(field('Vehicle type', 'vehicle_type', 'select', '', ['car', 'taxi', 'van', 'truck', 'motorcycle', 'bus']));
  form.appendChild(field('Seats', 'seats', 'number', '4'));
  const b = el('button', 'btn', 'Add vehicle'); b.type = 'submit';
  form.appendChild(b);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form).entries());
    try { await api('/provider/vehicles', { method: 'POST', body: JSON.stringify(body) }); toast('Vehicle added'); providerVehicles(); }
    catch (ex) { toast(ex.message); }
  };
  v.appendChild(form);
  try {
    const { vehicles } = await api('/provider/vehicles');
    if (vehicles.length) {
      const t = el('table', 'table');
      t.innerHTML = '<thead><tr><th>Make/Model</th><th>Plate</th><th>Type</th><th>Seats</th></tr></thead>';
      const tb = el('tbody', '');
      vehicles.forEach(vh => {
        const tr = el('tr', '');
        tr.innerHTML = `<td>${esc(vh.make)} ${esc(vh.model || '')}</td><td>${esc(vh.plate_number)}</td><td>${esc(vh.vehicle_type)}</td><td>${vh.seats}</td>`;
        tb.appendChild(tr);
      });
      t.appendChild(tb);
      v.appendChild(t);
    }
  } catch (e) {}
  return v;
}

/* ---------------- CHAT ---------------- */
async function chatView() {
  const v = el('div', 'container');
  v.appendChild(backBtn());
  v.appendChild(el('h1', '', 'Messages'));
  if (!state.user) { v.appendChild(el('div', 'alert info', 'Login to see your messages.')); return v; }
  const newBtn = el('button', 'btn', '+ New message');
  newBtn.onclick = () => go('new-chat');
  v.appendChild(newBtn);
  const list = el('div', 'chat-list');
  list.style.marginTop = '16px';
  try {
    const { conversations } = await api('/chat/conversations');
    if (!conversations.length) {
      list.appendChild(el('div', 'empty', '<div class="icon">💬</div>No conversations yet. Start a new message.'));
    } else {
      conversations.forEach(c => {
        const row = el('div', 'chat-row');
        row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border:1px solid #e5e7eb;border-radius:12px;margin-bottom:8px;cursor:pointer;background:#fff';
        const left = el('div', '');
        left.appendChild(el('div', '', `<strong>${esc(c.other_name || c.other_email)}</strong> <span class="muted">· ${esc(c.other_role)}</span>`));
        left.appendChild(el('div', 'muted', esc(c.last_message || 'No messages yet')));
        const right = el('div', '');
        if (c.unread > 0) right.appendChild(el('span', 'badge red', String(c.unread)));
        right.appendChild(el('div', 'muted', fmtDT(c.last_message_at)));
        row.appendChild(left); row.appendChild(right);
        row.onclick = () => go('chat-thread', { id: c.id });
        list.appendChild(row);
      });
    }
  } catch (e) { list.appendChild(el('div', 'alert error', esc(e.message))); }
  v.appendChild(list);
  return v;
}

async function chatThreadView() {
  const v = el('div', 'container');
  v.appendChild(backBtn('Messages'));
  try {
    const { conversation, messages } = await api(`/chat/conversations/${state.params.id}/messages`);
    const otherId = conversation.user_a === state.user.id ? conversation.user_b : conversation.user_a;
    const other = messages.length ? (messages[0].sender_id === otherId ? messages[0] : null) : null;
    v.appendChild(el('h1', '', 'Chat'));
    const box = el('div', 'chat-box');
    box.style.cssText = 'border:1px solid #e5e7eb;border-radius:12px;padding:16px;min-height:300px;max-height:420px;overflow-y:auto;background:#fafafa;margin:16px 0';
    messages.forEach(m => {
      const mine = m.sender_id === state.user.id;
      const row = el('div', '');
      row.style.cssText = `display:flex;justify-content:${mine ? 'flex-end' : 'flex-start'};margin-bottom:10px`;
      const bubble = el('div', '');
      bubble.style.cssText = `max-width:75%;padding:10px 14px;border-radius:12px;background:${mine ? '#111' : '#fff'};color:${mine ? '#fff' : '#111'};border:${mine ? 'none' : '1px solid #e5e7eb'}`;
      bubble.appendChild(el('div', '', esc(m.body)));
      bubble.appendChild(el('div', 'muted', `${esc(m.sender_name)} · ${fmtDT(m.created_at)}`));
      if (mine) bubble.querySelector('div:last-child').style.color = '#aaa';
      row.appendChild(bubble);
      box.appendChild(row);
    });
    v.appendChild(box);
    const form = el('form', '');
    form.style.cssText = 'display:flex;gap:8px';
    const input = el('input', '', '');
    input.placeholder = 'Type a message…';
    input.style.flex = '1';
    const send = el('button', 'btn', 'Send'); send.type = 'submit';
    form.appendChild(input); form.appendChild(send);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      try {
        await api(`/chat/conversations/${state.params.id}/messages`, { method: 'POST', body: JSON.stringify({ body: text }) });
        render();
      } catch (ex) { toast(ex.message); }
    };
    v.appendChild(form);
    api(`/chat/conversations/${state.params.id}/read`, { method: 'POST' }).catch(() => {});
  } catch (e) { v.appendChild(el('div', 'alert error', esc(e.message))); }
  return v;
}

async function newChatView() {
  const v = el('div', 'container');
  v.appendChild(backBtn('Messages'));
  v.appendChild(el('h1', '', 'New message'));
  const q = el('input', '', '');
  q.placeholder = 'Search name, email or phone…';
  q.style.cssText = 'width:100%;padding:12px;border:1px solid #e5e7eb;border-radius:10px;margin:16px 0';
  v.appendChild(q);
  const list = el('div', '');
  const load = async () => {
    list.innerHTML = '';
    try {
      const { users } = await api(`/chat/users?q=${encodeURIComponent(q.value)}`);
      if (!users.length) { list.appendChild(el('div', 'empty', 'No users found you can message.')); return; }
      users.forEach(u => {
        const row = el('div', 'chat-row');
        row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border:1px solid #e5e7eb;border-radius:12px;margin-bottom:8px;cursor:pointer;background:#fff';
        const left = el('div', '');
        left.appendChild(el('div', '', `<strong>${esc(u.full_name || u.email)}</strong> <span class="muted">· ${esc(u.role)}</span>`));
        left.appendChild(el('div', 'muted', esc(u.email)));
        const btn = el('button', 'btn sm', 'Message');
        btn.onclick = async () => {
          try {
            const { conversation } = await api('/chat/conversations', { method: 'POST', body: JSON.stringify({ user_id: u.id }) });
            go('chat-thread', { id: conversation.id });
          } catch (ex) { toast(ex.message); }
        };
        row.appendChild(left); row.appendChild(btn);
        list.appendChild(row);
      });
    } catch (e) { list.appendChild(el('div', 'alert error', esc(e.message))); }
  };
  q.oninput = load;
  v.appendChild(list);
  load();
  return v;
}

/* ---------------- RENDER ---------------- */
function render() {
  const app = $('#app');
  app.innerHTML = '';
  app.appendChild(nav());
  const main = el('div', 'container');
  const view = state.view;
  if (view === 'home' && state.params.q) mountAsync(main, resultsView);
  else if (view === 'home' && state.params.category) main.appendChild(categoryView(state.params.category));
  else if (view === 'home') main.appendChild(homeView());
  else if (view === 'rides') main.appendChild(categoryView('ride'));
  else if (view === 'delivery') main.appendChild(categoryView('delivery'));
  else if (view === 'hotels') main.appendChild(categoryView('hotel'));
  else if (view === 'short_stay') main.appendChild(categoryView('short_stay'));
  else if (view === 'apartments') main.appendChild(categoryView('apartment'));
  else if (view === 'listing') mountAsync(main, listingView);
  else if (view === 'login' || view === 'register') { app.appendChild(authView(view)); return; }
  else if (view === 'account') main.appendChild(accountView());
  else if (view === 'provider') main.appendChild(providerView());
  else if (view === 'chat') mountAsync(main, chatView);
  else if (view === 'chat-thread') mountAsync(main, chatThreadView);
  else if (view === 'new-chat') mountAsync(main, newChatView);
  else if (view === 'book') main.appendChild(bookView());
  else if (view === 'rate') main.appendChild(rateView());
  else if (view === 'new-dispute') main.appendChild(newDisputeView());
  else if (view === 'new-listing') main.appendChild(newListingView());
  else main.appendChild(homeView());
  app.appendChild(main);
  app.appendChild(el('footer', 'footer', '© 2026 PANDOX ODA CONNECT · Akim Oda, Eastern Region, Ghana · <a href="#policies">Policies</a>'));
}

// Boot
(async function boot() {
  if (state.token) {
    try {
      const me = await api('/auth/me');
      state.user = me.user;
      const prov = await api('/provider/me').catch(() => null);
      state.provider = prov ? prov.provider : null;
    } catch (e) { state.token = null; localStorage.removeItem('pandox_token'); }
  }
  loadCatalog();
})();
