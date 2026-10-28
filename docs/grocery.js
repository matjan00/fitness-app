// Grocery list: pick days planned in Fitatu (today and the next 13 that have meals, 'fitatu-plan') and
// get everything still to eat on them added up per product, recipes split into their ingredients.
// Ticks are kept in config 'grocery' so they show on every device.

import { $, $$, esc, icon, toast, today, addDays, fromDay, niceDate } from './util.js';
import * as store from './store.js';
import { push, page } from './nav.js';
import { groceryList, amountText, listText } from './grocery-calc.js';

let chosen = null; // days picked this session; null = every planned day

export const plannedDays = () => store.all('fitatu-plan').filter((p) => p.day >= today() && Array.isArray(p.lines) && p.lines.length);

const ticks = () => store.getConfig('grocery', {}).ticked || {};
const saveTicks = (ticked) => store.setConfig('grocery', { ticked });

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
