// App shell: login, bottom tabs, and wiring the feature modules together.
//
// Each feature module (gym.js, food.js, run.js) exports:
//   tab       { id, title, icon, render(el) }       – its bottom tab
//   homeCard  { order, render(el) } | null          – a card on the Home tab (el is an empty <div>)
//   meSection { order, render(el) } | null          – a section on the Me tab
//   banner    (el) => boolean | undefined           – optional strip above the tabs (e.g. workout in progress); return true if shown
//   init()    optional, called once after data is loaded
// Tabs re-render automatically whenever the store changes.

import { $, $$, esc, icon, toast, local } from './util.js';
import * as store from './store.js';
import { setRevealHandler, depth } from './nav.js';
import * as gym from './gym.js';
import * as food from './food.js';
import * as run from './run.js';
import * as me from './me.js';
import { APP_VERSION } from './version.js';

const modules = [gym, run, food, me];
const tabs = [
  { id: 'home', title: 'Home', icon: 'home', render: renderHome },
  gym.tab, run.tab, food.tab, me.tab,
];
let current = local.get('tab', 'home');
if (!tabs.some((t) => t.id === current)) current = 'home';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

// ---------- updates ----------
// version.js travels with the (cached) app; version.json is always fetched fresh from the website.
// When the website has a newer number, Home shows an "Update" button that drops the saved copy and reloads.
let newVersion = null;

async function checkForUpdate() {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const { v } = await res.json();
    if (Number(v) > APP_VERSION && newVersion !== v) {
      newVersion = v;
      if (current === 'home') renderTab();
    }
  } catch { /* offline — try again later */ }
}

async function applyUpdate() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
    await Promise.all(regs.map((r) => r.update().catch(() => {})));
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== 'fit-images').map((k) => caches.delete(k)));
  } catch { /* reload anyway */ }
  location.reload();
}

function renderHome(el) {
  el.innerHTML = `<div class="page-head"><p class="muted">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
    <h1>${greeting()}</h1></div>
    ${newVersion ? `<div class="card update-card"><div class="grow"><b>New version available</b>
      <p class="small muted">Get the latest features and fixes. Your data stays.</p></div>
      <button class="primary" id="app-update">${icon('sync')} Update</button></div>` : ''}
    <div class="home-cards"></div>`;
  $('#app-update', el)?.addEventListener('click', (e) => { e.currentTarget.disabled = true; applyUpdate(); });
  const wrap = $('.home-cards', el);
  modules.map((m) => m.homeCard).filter(Boolean).sort((a, b) => a.order - b.order).forEach((c) => {
    const d = document.createElement('div');
    wrap.append(d);
    try { c.render(d); } catch (e) { console.error(e); d.innerHTML = `<div class="card error">${esc(e.message)}</div>`; }
  });
}

function renderTab() {
  const t = tabs.find((x) => x.id === current);
  const el = $('#view');
  el.dataset.tab = current;
  try { t.render(el); } catch (e) {
    console.error(e);
    el.innerHTML = `<div class="card"><p class="error">Something went wrong: ${esc(e.message)}</p></div>`;
  }
  $$('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === current));
  renderBanner();
}

function renderBanner() {
  const el = $('#banner');
  let shown = false;
  for (const m of modules) {
    if (m.banner && !shown) {
      el.innerHTML = '';
      shown = Boolean(m.banner(el));
    }
  }
  if (!shown) el.innerHTML = '';
  el.hidden = !shown;
}

export function showTab(id) {
  if (current !== id) {
    current = id;
    local.set('tab', id);
    $('#view').scrollTo?.(0, 0);
    window.scrollTo(0, 0);
  }
  renderTab();
}
window.showTab = showTab;

function buildTabbar() {
  $('#tabbar').innerHTML = tabs.map((t) => `<button data-tab="${t.id}">${icon(t.icon)}<span>${esc(t.title)}</span></button>`).join('');
  $('#tabbar').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) showTab(b.dataset.tab);
  });
}

// ---------- start ----------
async function start() {
  await store.openStore();

  if (store.configured && !(await store.session()) && !local.get('skipLogin', false)) {
    await login();
  }

  buildTabbar();
  $('#loading').hidden = true;
  $('#app').hidden = false;
  modules.forEach((m) => { try { m.init?.(); } catch (e) { console.error(e); } });
  renderTab();

  let pending = null;
  store.onChange(() => {
    // Batch bursts of changes into one redraw.
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = null;
      renderTab();
    });
  });
  setRevealHandler(renderTab);
  store.syncNow().catch(() => {});
  checkForUpdate();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // When a new version of the app takes over, reload once so the new files are used straight away.
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloaded && !depth()) { reloaded = true; location.reload(); }
    });
    navigator.serviceWorker.register('sw.js').then((r) => r.update()).catch(() => {});
  }
}

function login() {
  return new Promise((resolve) => {
    $('#loading').hidden = true;
    const box = $('#login');
    box.hidden = false;
    const form = $('#login-form');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const err = $('.error', form);
      err.hidden = true;
      const btn = $('button[type=submit]', form);
      btn.disabled = true;
      try {
        await store.signIn(form.email.value.trim(), form.password.value);
        box.hidden = true;
        resolve();
      } catch (ex) {
        err.textContent = ex.message === 'Invalid login credentials' ? 'Wrong email or password.' : ex.message;
        err.hidden = false;
      } finally {
        btn.disabled = false;
      }
    };
    $('#login-skip').onclick = () => {
      local.set('skipLogin', true);
      box.hidden = true;
      toast('Working offline on this device only. Log in from the Me tab to sync.');
      resolve();
    };
  });
}

window.addEventListener('error', (e) => console.error('Unhandled', e.error || e.message));
start().catch((e) => {
  console.error(e);
  $('#loading').innerHTML = `<div class="card"><p class="error">Could not start: ${esc(e.message)}</p><button class="primary" onclick="location.reload()">Try again</button></div>`;
});
