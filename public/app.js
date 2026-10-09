'use strict';
/* PANDOX ODA CONNECT — customer/provider app (vanilla SPA) */
const API = '/api';
const state = { user: null, token: localStorage.getItem('pandox_token'), view: 'home', provider: null, catalog: [], categories: [] };

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtGHS = (n) => `GH₵ ${Number(n || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const toast = (msg) => { const t = el('div', 'toast', esc(msg)); document.body.appendChild(t); setTimeout(() => t.remove(), 3500); };

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
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
  const brand = el('a', 'brand', 'PANDOX ODA CONNECT');
  brand.href = '#'; brand.onclick = (e) => { e.preventDefault(); go('home'); };
  n.appendChild(brand);
  const ul = el('ul', '');
  for (const [v, label] of links) {
    const li = el('li', '');
    const a = el('a', '', label);
    a.href = '#'; a.onclick = (e) => { e.preventDefault(); go(v); };
    li.appendChild(a); ul.appendChild(li);
  }
  n.appendChild(ul);
  const u = el('div', 'nav-user');
  if (state.user) {
    const name = el('span', '', esc(state.user.full_name || state.user.email));
    const out = el('button', 'btn sm', 'Logout');
    out.href = '#'; out.onclick = async (e) => { e.preventDefault(); await api('/auth/logout', { method: 'POST' }).catch(() => {}); state.token = null; localStorage.removeItem('pandox_token'); state.user = null; state.provider = null; go('home'); };
    u.appendChild(name); u.appendChild(out);
  } else {
    const login = el('button', 'btn sm', 'Login');
    login.onclick = () => go('login');
    const reg = el('button', 'btn sm outline', 'Register');
    reg.onclick = () => go('register');
    u.appendChild(login); u.appendChild(reg);
  }
  n.appendChild(u);
  return n;
}

function go(view, params = {}) {
  state.view = view; state.params = params;
  if (view === 'account' || view === 'provider' || view === 'bookings' || view === 'disputes') loadUser();
  else render();
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
  const v = el('div', '');
  const hero = el('div', 'hero');
  hero.appendChild(el('h1', '', 'Everything in Akim Oda. One platform.'));
  hero.appendChild(el('p', '', 'Book rides, send deliveries, find hotels, short-stay and apartments — all verified, all in one place.'));
  const search = el('div', 'search');
  const input = el('input', '', ''); input.placeholder = 'Search services, hotels, apartments…';
  const btn = el('button', 'btn', 'Search');
  btn.onclick = () => go('home', { q: input.value });
  search.appendChild(input); search.appendChild(btn);
  hero.appendChild(search);
  v.appendChild(hero);
  const grid = el('div', 'grid');
  for (const [cat, meta] of Object.entries(CATEGORY_META)) {
    const card = el('div', 'card cat-card');
    card.onclick = () => go('home', { category: cat });
    card.appendChild(el('div', 'cat-icon', meta.icon));
    card.appendChild(el('h3', '', meta.label));
    card.appendChild(el('p', 'muted', 'Browse and book'));
    grid.appendChild(card);
  }
  v.appendChild(grid);
  return v;
}

function categoryView(cat) {
  const v = el('div', '');
  const meta = CATEGORY_META[cat] || { icon: '✨', label: cat };
  v.appendChild(el('h2', '', `${meta.icon} ${meta.label}`));
  const list = el('div', 'list');
  const items = state.catalog.filter(l => l.category === cat);
  if (!items.length) list.appendChild(el('p', 'muted', 'No listings yet — check back soon.'));
  for (const l of items) {
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

function listingView() {
  const v = el('div', '');
  const id = state.params.id;
  const l = state.catalog.find(x => x.id === id);
  if (!l) { v.appendChild(el('p', 'muted', 'Listing not found.')); return v; }
  v.appendChild(el('h2', '', esc(l.title)));
  if (l.description) v.appendChild(el('p', '', esc(l.description)));
  v.appendChild(el('p', 'price', fmtGHS(l.price)));
  const btn = el('button', 'btn', 'Book now');
  btn.onclick = () => go('book', { id: l.id });
  v.appendChild(btn);
  return v;
}

function field(label, name, type, placeholder, options) {
  const wrap = el('div', 'field');
  wrap.appendChild(el('label', '', label));
  if (type === 'select') {
    const s = el('select', '', '');
    s.name = name;
    s.appendChild(el('option', '', 'Select…'));
    for (const o of options) s.appendChild(el('option', '', o));
    wrap.appendChild(s);
  } else {
    const i = el('input', '', '');
    i.type = type; i.name = name; i.placeholder = placeholder || '';
    wrap.appendChild(i);
  }
  return wrap;
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

function accountView() {
  const v = el('div', 'container');
  v.appendChild(el('h2', '', 'My account'));
  if (!state.user) { v.appendChild(el('p', 'muted', 'Please log in.')); return v; }
  const card = el('div', 'card');
  card.appendChild(el('p', '', `<strong>${esc(state.user.full_name || state.user.email)}</strong>`));
  card.appendChild(el('p', 'muted', esc(state.user.email)));
  if (state.user.phone) card.appendChild(el('p', 'muted', esc(state.user.phone)));
  const idBtn = el('button', 'btn sm', 'Submit identity verification');
  idBtn.onclick = async () => {
    try { await api('/auth/identity', { method: 'POST', body: JSON.stringify({}) }); toast('Identity submitted for review'); loadUser(); }
    catch (ex) { toast(ex.message); }
  };
  card.appendChild(idBtn);
  v.appendChild(card);
  return v;
}

function providerView() {
  const v = el('div', 'container');
  v.appendChild(el('h2', '', 'Provider dashboard'));
  if (!state.user) { v.appendChild(el('p', 'muted', 'Please log in.')); return v; }
  if (!state.provider) { v.appendChild(el('p', 'muted', 'You are not registered as a provider yet.')); return v; }
  const card = el('div', 'card');
  card.appendChild(el('p', '', `<strong>${esc(state.provider.business_name || state.provider.provider_type)}</strong>`));
  card.appendChild(el('p', 'muted', `Type: ${esc(state.provider.provider_type)} · Status: ${badge(state.provider.status)}`));
  v.appendChild(card);
  return v;
}

function bookView() {
  const v = el('div', 'container');
  v.appendChild(el('h2', '', 'Book'));
  const id = state.params.id;
  const l = state.catalog.find(x => x.id === id);
  if (!l) { v.appendChild(el('p', 'muted', 'Listing not found.')); return v; }
  v.appendChild(el('p', '', esc(l.title)));
  const f = el('form', '');
  f.appendChild(field('Date', 'date', 'date', ''));
  f.appendChild(field('Time', 'time', 'time', ''));
  const btn = el('button', 'btn', 'Confirm booking');
  btn.type = 'submit';
  f.appendChild(btn);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(f).entries());
    try {
      const r = await api('/bookings', { method: 'POST', body: JSON.stringify({ listing_id: id, ...body }) });
      toast('Booking created!');
      if (r.payment && r.payment.authorization_url) { window.location.href = r.payment.authorization_url; }
      else go('bookings');
    } catch (ex) { toast(ex.message); }
  };
  v.appendChild(f);
  return v;
}

function rateView() {
  const v = el('div', 'container');
  v.appendChild(el('h2', '', 'Rate your ride'));
  const f = el('form', '');
  f.appendChild(field('Rating (1-5)', 'rating', 'number', '5'));
  f.appendChild(field('Comment', 'comment', 'text', 'How was it?'));
  const btn = el('button', 'btn', 'Submit rating');
  btn.type = 'submit';
  f.appendChild(btn);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(f).entries());
    try { await api('/ratings', { method: 'POST', body: JSON.stringify(body) }); toast('Thanks for rating!'); go('home'); }
    catch (ex) { toast(ex.message); }
  };
  v.appendChild(f);
  return v;
}

function newDisputeView() {
  const v = el('div', 'container');
  v.appendChild(el('h2', '', 'Open a dispute'));
  const f = el('form', '');
  f.appendChild(field('Booking ID', 'booking_id', 'text', ''));
  f.appendChild(field('Reason', 'reason', 'text', 'What happened?'));
  const btn = el('button', 'btn', 'Submit dispute');
  btn.type = 'submit';
  f.appendChild(btn);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(f).entries());
    try { await api('/disputes', { method: 'POST', body: JSON.stringify(body) }); toast('Dispute submitted'); go('home'); }
    catch (ex) { toast(ex.message); }
  };
  v.appendChild(f);
  return v;
}

function newListingView() {
  const v = el('div', 'container');
  v.appendChild(el('h2', '', 'Add a listing'));
  const f = el('form', '');
  f.appendChild(field('Title', 'title', 'text', ''));
  f.appendChild(field('Category', 'category', 'select', '', ['ride', 'delivery', 'hotel', 'short_stay', 'apartment', 'property', 'other']));
  f.appendChild(field('Price (GHS)', 'price', 'number', ''));
  f.appendChild(field('Description', 'description', 'text', ''));
  const btn = el('button', 'btn', 'Submit listing');
  btn.type = 'submit';
  f.appendChild(btn);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(f).entries());
    try { await api('/listings', { method: 'POST', body: JSON.stringify(body) }); toast('Listing submitted!'); go('home'); }
    catch (ex) { toast(ex.message); }
  };
  v.appendChild(f);
  return v;
}

function render() {
  const app = $('#app');
  app.innerHTML = '';
  app.appendChild(nav());
  const main = el('div', 'container');
  const view = state.view;
  if (view === 'home') main.appendChild(homeView());
  else if (view === 'rides') main.appendChild(categoryView('ride'));
  else if (view === 'delivery') main.appendChild(categoryView('delivery'));
  else if (view === 'hotels') main.appendChild(categoryView('hotel'));
  else if (view === 'short_stay') main.appendChild(categoryView('short_stay'));
  else if (view === 'apartments') main.appendChild(categoryView('apartment'));
  else if (view === 'listing') main.appendChild(listingView());
  else if (view === 'login' || view === 'register') { app.appendChild(authView(view)); return; }
  else if (view === 'account') main.appendChild(accountView());
  else if (view === 'provider') main.appendChild(providerView());
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