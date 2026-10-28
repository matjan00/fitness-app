// Grocery list: pick days planned in Fitatu (today and the next 13 that have meals, 'fitatu-plan') and
// get everything still to eat on them added up per product, recipes split into their ingredients.
// Ticks and the chosen Listonic list are kept in config 'grocery' so they show on every device.
// "Send to Listonic" goes through the edge function supabase/functions/listonic.

import { $, $$, esc, icon, toast, today, addDays, fromDay, niceDate } from './util.js';
import * as store from './store.js';
import { push, page, chooseSheet } from './nav.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { groceryList, amountText, listText, listonicItems } from './grocery-calc.js';

let chosen = null; // days picked this session; null = every planned day

export const plannedDays = () => store.all('fitatu-plan').filter((p) => p.day >= today() && Array.isArray(p.lines) && p.lines.length);

const cfg = () => store.getConfig('grocery', {});
const saveCfg = (patch) => { const c = cfg(); delete c.id; return store.setConfig('grocery', { ...c, ...patch }); };
const ticks = () => cfg().ticked || {};
const saveTicks = (ticked) => saveCfg({ ticked });

async function callListonic(body) {
  let token = SUPABASE_KEY;
  try { const ss = await store.client?.auth.getSession(); if (ss?.data?.session?.access_token) token = ss.data.session.access_token; } catch { /* offline */ }
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/functions/v1/listonic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('No connection. Check your internet and try again.');
  }
  let res = null;
  try { res = await r.json(); } catch { /* not JSON */ }
  if (r.ok) return res || {};
  if (r.status === 404 && !res?.message) throw new Error('Listonic is not set up yet (see LISTONIC-SETUP.md).');
  if (r.status === 401) throw new Error('Log in first (person icon on Home), then try again.');
  throw new Error(res?.message || res?.error || 'Listonic did not answer. Try again in a minute.');
}

// The Listonic list to send to: the saved one, or picked now (also when `change` is set).
async function listonicList(change = false) {
  const saved = cfg().listonic;
  if (saved?.id && !change) return saved;
  toast('Loading your Listonic lists…');
  const { lists = [] } = await callListonic({ action: 'lists' });
  if (!lists.length) throw new Error('No lists in Listonic. Make one there first.');
  const id = await chooseSheet('Send to which Listonic list?', lists.map((l) => ({ value: l.id, label: l.name, icon: 'list' })));
  const pick = lists.find((l) => l.id === id);
  if (pick) await saveCfg({ listonic: pick });
  return pick || null;
}

let sending = false;
async function sendToListonic(items) {
  if (sending) return;
  sending = true;
  try {
    const list = await listonicList();
    if (!list) return;
    toast(`Sending ${items.length} product${items.length === 1 ? '' : 's'} to ${list.name}…`);
    const { added = 0, updated = 0 } = await callListonic({ action: 'send', list_id: list.id, items });
    toast(added + updated ? `On "${list.name}": ${added} added${updated ? `, ${updated} amount${updated === 1 ? '' : 's'} updated` : ''}` : `"${list.name}" already had all of it`, 4000);
  } catch (e) {
    toast(e.message || 'Could not send to Listonic', 5000);
  } finally {
    sending = false;
  }
}

export function openGrocery() {
  let off = null;
  push((el, s) => {
    off ??= store.onChange((kinds) => { if (kinds.has('fitatu-plan') || kinds.has('config')) s.render(); });
    const plans = plannedDays();
    const byDay = new Map(plans.map((p) => [p.day, p]));
    const days = plans.map((p) => p.day).sort();
    const picked = (chosen || days).filter((d) => byDay.has(d));
    const rows = groceryList(plans, picked);
    const ticked = ticks();
    const left = rows.filter((r) => !ticked[r.key]);
    const done = rows.filter((r) => ticked[r.key]);
    const dayLabel = (d) => (d === today() ? 'Today' : d === addDays(today(), 1) ? 'Tomorrow' : fromDay(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }));
    const rowHtml = (r) => `<button class="list-item gr-row ${ticked[r.key] ? 'done' : ''}" data-k="${esc(r.key)}" aria-pressed="${ticked[r.key] ? 'true' : 'false'}">
        <span class="gr-box">${ticked[r.key] ? icon('check') : ''}</span>
        <div class="grow"><b>${esc(r.name)}</b>${r.recipes.length ? `<div class="sub">for ${esc(r.recipes.join(', '))}</div>` : ''}</div>
        <span class="gr-amt">${esc(amountText(r))}</span></button>`;

    el.innerHTML = page({
      title: 'Grocery list',
      right: rows.length ? `<button class="icon-btn" id="gr-share" aria-label="Copy list">${icon('copy')}</button>` : '',
      body: `
      <p class="small muted" style="margin:0 2px 10px">Pick the days you are shopping for. Everything planned in Fitatu and not yet ticked as eaten is added up, recipes as their ingredients.</p>
      ${days.length ? `<div class="chips gr-days">${days.map((d) => `<button class="chip ${picked.includes(d) ? 'on' : ''}" data-day="${d}"
          aria-pressed="${picked.includes(d)}">${esc(dayLabel(d))}</button>`).join('')}</div>` : ''}
      ${days.length ? `<div class="row between" style="margin:2px 2px 12px"><span class="tiny muted">${picked.length} of ${plans.length} planned day${plans.length === 1 ? '' : 's'}</span>
        <span>${picked.length < plans.length ? '<button class="link small" id="gr-all">All days</button>' : ''}${picked.length ? ' <button class="link small" id="gr-none">Clear</button>' : ''}</span></div>` : ''}
      ${!plans.length ? `<div class="card empty">${icon('list')}<p>Nothing planned in Fitatu from today on.</p><p class="tiny" style="margin-top:6px">Plan meals in Fitatu; they show up here after the next sync (every 2 hours).</p></div>`
        : !rows.length ? '<div class="card empty"><p>Pick at least one day.</p></div>'
        : `<div class="card"><div class="list">${left.map(rowHtml).join('') || '<p class="small muted" style="padding:8px 2px">All bought.</p>'}</div></div>
          ${done.length ? `<div class="row between"><h3 class="section-title">In the basket (${done.length})</h3><button class="link small" id="gr-untick" style="margin-top:14px">Untick all</button></div>
            <div class="card"><div class="list">${done.map(rowHtml).join('')}</div></div>` : ''}
          ${left.length ? `<button class="primary block" id="gr-listonic" style="margin-top:14px">${icon('upload')} Send to Listonic</button>
            <p class="tiny muted center" style="margin-top:6px">${cfg().listonic ? `To "${esc(cfg().listonic.name)}" · <button class="link tiny" id="gr-lchange">change list</button>` : 'You pick the list the first time.'}
              Products already on it get their amount updated.</p>` : ''}
          <p class="tiny muted" style="margin:10px 2px 0">${rows.length} product${rows.length === 1 ? '' : 's'} for ${esc(picked.map((d) => niceDate(fromDay(d), { weekday: true })).join(', '))}.</p>`}`,
    });

    $$('[data-day]', el).forEach((b) => { b.onclick = () => {
      const d = b.dataset.day;
      chosen = picked.includes(d) ? picked.filter((x) => x !== d) : [...picked, d].sort();
      s.render();
    }; });
    $('#gr-all', el)?.addEventListener('click', () => { chosen = null; s.render(); });
    $('#gr-none', el)?.addEventListener('click', () => { chosen = []; s.render(); });
    $$('[data-k]', el).forEach((b) => { b.onclick = async () => {
      const t = { ...ticks() };
      if (t[b.dataset.k]) delete t[b.dataset.k]; else t[b.dataset.k] = true;
      await saveTicks(t);
      s.render();
    }; });
    $('#gr-untick', el)?.addEventListener('click', async () => { await saveTicks({}); s.render(); });
    $('#gr-listonic', el)?.addEventListener('click', () => sendToListonic(listonicItems(rows, ticked)));
    $('#gr-lchange', el)?.addEventListener('click', async () => {
      try { await listonicList(true); } catch (e) { toast(e.message, 5000); }
      s.render();
    });
    $('#gr-share', el)?.addEventListener('click', async () => {
      const text = listText(rows, ticked);
      try {
        if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: 'Grocery list', text });
        else { await navigator.clipboard.writeText(text); toast('List copied'); }
      } catch (e) {
        if (e?.name !== 'AbortError') toast('Could not copy the list');
      }
    });
  }, { onClose: () => off?.() });
}
