// Shopping list screens: builder (recipes + diary days) and the tick-off list. Logic is in shopping.js.
// The last list (with ticks) is kept in localStorage ('shop-list'), so it survives a reload.
import { $, $$, esc, icon, toast, local, today, addDays, fromDay, niceDate, parseNum } from './util.js';
import * as store from './store.js';
import { push, page, confirmSheet } from './nav.js';
import { loadLibrary } from './food-library.js';
import { buildList, grouped, listText, dayRange, gramsText } from './shopping.js';

const KEY = 'shop-list';
const saved = () => { const l = local.get(KEY, null); return l && Array.isArray(l.items) ? l : null; };
const dayName = (d) => (d === today() ? 'Today' : niceDate(fromDay(d), { weekday: true }));

// ---------- builder ----------
export function openShopping() {
  const sel = {};                          // recipe id → servings
  const days = new Set(dayRange(today(), 7, addDays));
  push((el, s) => {
    const recipes = store.all('recipe').sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    const last = saved();
    const dayList = [...new Set([...dayRange(today(), 7, addDays), ...days])].sort();
    const nEntries = store.all('meal').filter((e) => days.has(e.day)).length;
    el.innerHTML = page({ title: 'Shopping list', body: `
      ${last ? `<button class="card block fd-shop-last" id="sh-last"><div class="row between"><div><b>Open last list</b>
        <p class="tiny muted">${last.items.filter((i) => i.done).length} of ${last.items.length} ticked · ${esc(niceDate(last.created))}</p></div>${icon('list')}</div></button>` : ''}
      <h3 class="section-title">Diary days</h3>
      <p class="tiny muted" style="margin:-4px 2px 8px">Everything logged on the ticked days goes on the list; recipes are split into ingredients.</p>
      <div class="chips fd-shop-days">${dayList.map((d) => `<button class="chip ${days.has(d) ? 'on' : ''}" data-day="${d}">${esc(dayName(d))}</button>`).join('')}</div>
      <div class="row" style="gap:8px;margin-top:10px"><input type="date" id="sh-date" class="grow"><button class="soft" id="sh-adddate">Add day</button></div>
      <div class="row" style="gap:8px;margin-top:8px"><button class="ghost" id="sh-next">Next 7 days</button><button class="ghost" id="sh-prev">Last 7 days</button><button class="ghost" id="sh-none">None</button></div>
      <p class="tiny muted" style="margin:8px 2px 0">${days.size} day${days.size === 1 ? '' : 's'} · ${nEntries} diary entr${nEntries === 1 ? 'y' : 'ies'}</p>
      <h3 class="section-title">Recipes</h3>
      ${recipes.length ? `<div class="card" style="padding-top:4px;padding-bottom:4px">${recipes.map((r) => {
        const on = r.id in sel;
        return `<div class="fd-shop-rec"><button class="fd-shop-pick ${on ? 'on' : ''}" data-rec="${r.id}" aria-pressed="${on}"><span class="fd-shop-box">${on ? icon('check') : ''}</span>
          <span class="grow ellipsis">${esc(r.title)}</span></button>
          ${on ? `<label class="fd-shop-srv">servings <input inputmode="decimal" data-srv="${r.id}" value="${esc(String(sel[r.id]))}"></label>` : ''}</div>`;
      }).join('')}</div>` : '<div class="card empty small">No recipes in your recipe book yet.</div>'}` ,
      footer: `<button class="primary block" id="sh-build">Make list</button>` });

    $('#sh-last', el)?.addEventListener('click', () => openList());
    $$('[data-day]', el).forEach((b) => { b.onclick = () => { const d = b.dataset.day; days.has(d) ? days.delete(d) : days.add(d); s.render(); }; });
    $('#sh-adddate', el).onclick = () => { const v = $('#sh-date', el).value; if (v) { days.add(v); s.render(); } };
    $('#sh-next', el).onclick = () => { days.clear(); dayRange(today(), 7, addDays).forEach((d) => days.add(d)); s.render(); };
    $('#sh-prev', el).onclick = () => { days.clear(); dayRange(addDays(today(), -6), 7, addDays).forEach((d) => days.add(d)); s.render(); };
    $('#sh-none', el).onclick = () => { days.clear(); s.render(); };
    $$('[data-rec]', el).forEach((b) => { b.onclick = () => {
      const id = b.dataset.rec;
      if (id in sel) delete sel[id]; else sel[id] = recipes.find((r) => r.id === id)?.servings || 1;
      s.render();
    }; });
    $$('[data-srv]', el).forEach((i) => { i.onchange = () => { const v = parseNum(i.value); if (v > 0) sel[i.dataset.srv] = v; else i.value = String(sel[i.dataset.srv]); }; });
    $('#sh-build', el).onclick = async () => {
      $$('[data-srv]', el).forEach((i) => i.onchange());
      const chosen = recipes.filter((r) => r.id in sel).map((rec) => ({ rec, servings: sel[rec.id] }));
      const entries = store.all('meal').filter((e) => days.has(e.day));
      if (!chosen.length && !entries.length) { toast('Pick a recipe or a day with diary entries'); return; }
      const lib = await libraryLookup(entries);
      const own = new Map(store.all('recipe').map((r) => [r.id, r]));
      const { items, skipped } = buildList({ recipes: chosen, entries, lookup: (src) => (src.type === 'library' ? lib.get(src.id) : own.get(src.id)) || null });
      if (!items.length) { toast('Nothing to buy: no ingredients with a weight found'); return; }
      local.set(KEY, { created: new Date().toISOString(), items, skipped });
      openList();
    };
  });
}

// Library recipes are needed only when the chosen days contain library entries.
async function libraryLookup(entries) {
  const m = new Map();
  if (!entries.some((e) => e.source?.type === 'library')) return m;
  try { (await loadLibrary(store.all('library'))).recipes.forEach((r) => m.set(r.id, r)); } catch { /* offline / not imported: those entries are listed as not included */ }
  return m;
}

// ---------- list ----------
function openList() {
  push((el, s) => {
    const l = saved();
    if (!l) { el.innerHTML = page({ title: 'Shopping list', body: '<div class="card empty small">No list yet.</div>' }); return; }
    const left = l.items.filter((i) => !i.done).length;
    el.innerHTML = page({ title: 'Shopping list', sub: `${left} left of ${l.items.length}`,
      right: `<button class="icon-btn" id="sh-share" aria-label="Share or copy as text">${icon('upload')}</button><button class="icon-btn" id="sh-clear" aria-label="Delete list">${icon('trash')}</button>`,
      body: `${grouped(l.items).map((g) => `<h3 class="section-title">${esc(g.label)}</h3><div class="card" style="padding-top:4px;padding-bottom:4px">
        ${g.items.map((it) => `<button class="fd-shop-row ${it.done ? 'done' : ''}" data-k="${esc(it.key)}" aria-pressed="${it.done}"><span class="fd-shop-box">${it.done ? icon('check') : ''}</span>
          <span class="grow">${esc(it.name)}</span><span class="muted small">${esc(amount(it))}</span></button>`).join('')}</div>`).join('')}
        ${l.skipped?.length ? `<h3 class="section-title">Not included</h3><div class="card"><p class="tiny muted">These diary entries have no ingredients to buy.</p>
          ${l.skipped.map((x) => `<p class="small" style="margin-top:6px">${esc(x.label)} <span class="muted">· ${esc(x.reason)}</span></p>`).join('')}</div>` : ''}
        <p class="tiny muted center" style="margin-top:14px">“+” after an amount means some recipes gave no weight for that item.</p>`,
      footer: `<div class="row" style="gap:8px"><button class="ghost grow" id="sh-uncheck">Untick all</button><button class="primary grow" id="sh-copy">Copy as text</button></div>` });

    $$('[data-k]', el).forEach((b) => { b.onclick = () => {
      const it = l.items.find((i) => i.key === b.dataset.k);
      if (it) { it.done = !it.done; local.set(KEY, l); s.render(); }
    }; });
    $('#sh-uncheck', el).onclick = () => { l.items.forEach((i) => { i.done = false; }); local.set(KEY, l); s.render(); };
    $('#sh-copy', el).onclick = () => copyText(listText(l.items, { all: true }));
    $('#sh-share', el).onclick = () => shareText(listText(l.items));
    $('#sh-clear', el).onclick = async () => { if (await confirmSheet('Delete this shopping list?', { ok: 'Delete', danger: true })) { local.del(KEY); s.close(); } };
  });
}
const amount = (it) => (it.grams > 0 ? `${gramsText(it.grams)}${it.partial ? ' +' : ''}` : '');

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('List copied'); } catch { toast('Could not copy'); }
}
// Share sheet where the browser has one, else the clipboard.
async function shareText(text) {
  if (navigator.share) {
    try { await navigator.share({ title: 'Shopping list', text }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  copyText(text);
}
