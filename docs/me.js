// "Me / settings" screen: sections contributed by the feature modules (body weight, targets, Garmin sync status…),
// then account / sync and backup, which live here.

import { $, esc, icon, toast, local, niceDate, niceTime } from './util.js';
import * as store from './store.js';
import * as gym from './gym.js';
import * as food from './food.js';
import * as run from './run.js';
import * as cut from './cut.js';
import * as update from './update.js';
import { push, page } from './nav.js';

// Opened as a full-screen page from the icon at the top-right of Home (see app.js).
export function openMe() {
  push((el) => {
    el.innerHTML = page({ title: 'Me / settings', body: '' });
    render($('.scroll', el), false);
  });
}
export const homeCard = null;

function render(el, head = true) {
  el.innerHTML = `${head ? '<div class="page-head"><h1>Me</h1></div>' : ''}<div id="me-sections" class="stack"></div>
    <h3 class="section-title">Account &amp; sync</h3><div class="card" id="me-sync"></div>
    <h3 class="section-title">Backup</h3>
    <div class="card stack-sm">
      <p class="small muted">Download everything as one file, or restore from such a file.</p>
      <div class="fab-row">
        <button class="ghost" id="me-export">${icon('download')} Export</button>
        <button class="ghost" id="me-import">${icon('upload')} Import</button>
      </div>
      <input type="file" id="me-file" accept="application/json,.json" hidden>
    </div>
    <h3 class="section-title">App</h3>
    <div class="card row between" id="me-version"></div>
    <p class="tiny muted center" style="margin-top:24px">Exercise pictures: free-exercise-db (public domain)</p>`;
  renderVersion($('#me-version', el));

  const wrap = $('#me-sections', el);
  [cut, gym, run, food].map((m) => m.meSection).filter(Boolean).sort((a, b) => a.order - b.order).forEach((s) => {
    const d = document.createElement('div');
    wrap.append(d);
    try { s.render(d); } catch (e) { console.error(e); d.innerHTML = `<div class="card error">${esc(e.message)}</div>`; }
  });

  renderSync($('#me-sync', el));

  $('#me-export', el).onclick = () => {
    const blob = new Blob([JSON.stringify(store.exportAll())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fit-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  $('#me-import', el).onclick = () => $('#me-file', el).click();
  $('#me-file', el).onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const n = await store.importAll(JSON.parse(await f.text()));
      toast(`Restored ${n} items`);
    } catch (ex) {
      toast(ex.message);
    }
  };
}

// "App version 11 · Up to date" with a Check for updates / Update button.
function renderVersion(box, status = '') {
  const newer = update.newerVersion();
  box.innerHTML = `<div class="grow"><b>App version ${update.APP_VERSION}</b>
      <p class="small ${newer ? 'up' : 'muted'}">${newer ? `Version ${newer} is available` : esc(status || 'Tap to check for a newer version')}</p></div>
    <button class="${newer ? 'primary' : 'ghost'}" id="me-update">${icon('sync')} ${newer ? 'Update' : 'Check'}</button>`;
  $('#me-update', box).onclick = async (e) => {
    e.currentTarget.disabled = true;
    if (update.newerVersion()) return update.applyUpdate();
    try {
      await update.checkForUpdate();
      renderVersion(box, 'Up to date');
    } catch {
      renderVersion(box, "Couldn't check — are you online?");
    }
  };
}

async function renderSync(box) {
  if (!store.configured) {
    box.innerHTML = `<p class="small muted">Sync is not set up yet — your data is saved on this device only.</p>`;
    return;
  }
  const s = store.syncState();
  const sess = await store.session();
  if (!sess) {
    box.innerHTML = `<p class="small muted" style="margin-bottom:12px">Log in to back up and sync your data across devices.</p>
      <form class="form" id="me-login">
        <label>Email<input type="email" name="email" autocomplete="username" required></label>
        <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
        <p class="error small" hidden></p>
        <button class="primary" type="submit">Log in</button>
      </form>`;
    $('#me-login', box).onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        await store.signIn(f.email.value.trim(), f.password.value);
        local.set('skipLogin', false);
        toast('Logged in — syncing');
        renderSync(box);
      } catch (ex) {
        const err = $('.error', f);
        err.textContent = ex.message === 'Invalid login credentials' ? 'Wrong email or password.' : ex.message;
        err.hidden = false;
      }
    };
    return;
  }
  const label = {
    idle: s.pending ? `${s.pending} change(s) waiting to upload` : 'Everything is backed up',
    syncing: 'Syncing…',
    offline: `Offline — ${s.pending} change(s) will upload when you're back online`,
    error: `Sync problem: ${s.error}`,
  }[s.status] || s.status;
  box.innerHTML = `<div class="row between">
      <div class="grow"><b class="ellipsis" style="display:block">${esc(sess.user.email)}</b>
      <p class="small ${s.status === 'error' ? 'error' : 'muted'}">${esc(label)}</p>
      ${s.at ? `<p class="tiny muted">Last sync ${niceDate(s.at)} ${niceTime(s.at)}</p>` : ''}</div>
      <button class="icon-btn" id="me-syncnow" aria-label="Sync now">${icon('sync')}</button>
    </div>
    <button class="link small" id="me-logout" style="margin-top:12px">Log out</button>`;
  $('#me-syncnow', box).onclick = () => store.syncNow().then(() => toast('Synced')).catch((e) => toast(e.message));
  $('#me-logout', box).onclick = async () => { await store.signOut(); renderSync(box); };
}
