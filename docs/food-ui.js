// Shared Food UI pieces: formatting, macro ring/bars, food picker (table + Open Food Facts + custom foods),
// amount sheet, custom food form. Used by food.js (diary) and food-recipes.js (recipe book).

import { $, $$, esc, icon, toast, n0, n1, parseNum } from './util.js';
import * as store from './store.js';
import { push, page, sheet } from './nav.js';
import { loadFoods, buildIndex, search, unitOptions, foodLabel, matchKey } from './food-db.js';
import { macrosFor } from './food-calc.js';

export const MEALS = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
  { key: 'snack', label: 'Snacks' },
];
export const mealLabel = (k) => MEALS.find((m) => m.key === k)?.label || k;

export const settings = () => store.getConfig('food', {});
export const targets = () => settings().targets || null;
export async function saveSettings(patch) {
  const cur = settings();
  delete cur.id;
  await store.setConfig('food', { ...cur, ...patch });
}

// ---------- formatting ----------
export const kcalTxt = (x) => `${n0(Math.round(x || 0))} kcal`;
export const g1 = (x) => `${n1(Math.round((x || 0) * 10) / 10)} g`;
export function macroLine(m, { kcal = true } = {}) {
  return `${kcal ? `<b>${n0(Math.round(m.kcal || 0))}</b> kcal · ` : ''}<span class="fd-p">P ${n0(Math.round(m.p || 0))}</span> · <span class="fd-c">C ${n0(Math.round(m.c || 0))}</span> · <span class="fd-f">F ${n0(Math.round(m.f || 0))}</span>`;
}
export function img(src, cls = '') {
  if (!src) return `<div class="fd-img fd-noimg ${cls}">${icon('food')}</div>`;
  return `<div class="fd-img ${cls}"><img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('fd-noimg');this.remove()">${icon('food')}</div>`;
}

// Kcal ring: eaten vs target.
export function ring(eaten, target, { size = 132, label = 'left' } = {}) {
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const pct = target ? Math.min(1, eaten / target) : 0;
  const over = target && eaten > target;
  const left = target ? Math.round(target - eaten) : null;
  return `<div class="fd-ring" style="width:${size}px;height:${size}px">
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="fd-ring-bg"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="fd-ring-fg ${over ? 'over' : ''}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    </svg>
    <div class="fd-ring-txt">${left == null ? `<b>${n0(eaten)}</b><span>kcal eaten</span>`
      : over ? `<b class="down">${n0(-left)}</b><span>kcal over</span>` : `<b>${n0(left)}</b><span>kcal ${label}</span>`}</div>
  </div>`;
}
export function bar(label, value, target, cls, unit = 'g') {
  const pct = target ? Math.min(100, (value / target) * 100) : 0;
  return `<div class="fd-bar ${cls}"><div class="row between"><span>${esc(label)}</span>
    <span class="muted small"><b>${n0(Math.round(value))}</b>${target ? ` / ${n0(target)}` : ''} ${unit}</span></div>
    <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div></div>`;
}

// ---------- foods: table + custom ----------
let idxCache = { key: '', index: null };
export function customFoods() {
  return store.all('food').map((f) => ({ ...f, src: 'custom' }));
}
export async function getIndex() {
  const db = await loadFoods();
  const custom = customFoods();
  const key = `${db.length}:${custom.map((f) => f.id + (f.name || '')).join('|')}`;
  if (idxCache.key !== key) idxCache = { key, index: buildIndex([...custom, ...db]) };
  return idxCache.index;
}
// A compact copy of a food stored with ingredients and diary entries (so they survive table changes / OFF items).
export function snap(food) {
  if (!food) return null;
  const s = { src: food.src || 'db', id: food.id, name: foodLabel(food), k: food.k, p: food.p, c: food.c, f: food.f };
  if (food.en) s.en = food.en;
  if (food.pl) s.pl = food.pl;
  if (food.u) s.u = food.u;
  if (food.brand) s.brand = food.brand;
  return s;
}
export function rememberMatch(name, food) {
  const key = matchKey(name);
  if (!key || !food) return;
  const old = store.all('foodmatch').find((m) => m.key === key);
  store.put('foodmatch', { ...(old ? { id: old.id } : {}), key, food: snap(food) });
}
export function remembered(name) {
  const key = matchKey(name);
  return key ? store.all('foodmatch').find((m) => m.key === key)?.food || null : null;
}

// ---------- Open Food Facts ----------
export async function searchOFF(q) {
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=30&sort_by=unique_scans_n&fields=code,product_name,product_name_pl,product_name_en,brands,nutriments,serving_quantity,image_front_small_url`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`Open Food Facts answered ${r.status}`);
    const j = await r.json();
    return (j.products || []).map((p) => {
      const n = p.nutriments || {};
      let k = n['energy-kcal_100g'];
      if (k == null && n.energy_100g != null) k = n.energy_100g / 4.184;
      const name = (p.product_name_pl || p.product_name || p.product_name_en || '').trim();
      if (k == null || !name) return null;
      const f = { src: 'off', id: `off:${p.code}`, name, brand: (p.brands || '').split(',')[0].trim() || null,
        k: Math.round(Number(k)), p: +(Number(n.proteins_100g) || 0).toFixed(1), c: +(Number(n.carbohydrates_100g) || 0).toFixed(1), f: +(Number(n.fat_100g) || 0).toFixed(1) };
      if (Number(p.serving_quantity) > 0) f.u = { serving: Number(p.serving_quantity) };
      return f;
    }).filter(Boolean);
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'Open Food Facts is not answering — try again later.' : e.message);
  } finally { clearTimeout(t); }
}

// ---------- food picker ----------
function foodRow(f, i, extra = '') {
  const src = f.src === 'off' ? '<span class="pill">OFF</span>' : f.src === 'custom' ? '<span class="pill accent">Mine</span>' : '';
  return `<button class="list-item fd-food" data-i="${i}"><div class="grow"><div class="ellipsis"><b>${esc(f.src === 'db' ? f.en : f.name)}</b></div>
    <div class="sub ellipsis">${f.src === 'db' ? esc(f.pl) : esc(f.brand || '')} ${src}</div></div>
    <div class="fd-food-k"><b>${n0(f.k)}</b><span>kcal/100 g</span></div>${extra}</button>`;
}

// Opens a search screen; resolves with the chosen food or null.
export function pickFood({ title = 'Choose food', query = '', hint = '' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    let q = query;
    let off = null; // null | 'loading' | [] | Error
    let list = [];
    push((el, s) => {
      el.innerHTML = page({ title, body: `
        <div class="search">${icon('search')}<input id="fd-q" type="search" placeholder="Search food (Polish or English)" value="${esc(q)}" autocomplete="off"></div>
        ${hint ? `<p class="tiny muted" style="margin:8px 4px 0">${esc(hint)}</p>` : ''}
        <div id="fd-res" class="card" style="margin-top:12px;padding-top:4px;padding-bottom:4px"></div>
        <div id="fd-off" style="margin-top:12px"></div>
        <button class="ghost block" id="fd-custom" style="margin-top:12px">${icon('plus')} Create my own food</button>` });
      const input = $('#fd-q', el);
      const draw = async () => {
        const res = $('#fd-res', el);
        const index = await getIndex().catch((e) => { res.innerHTML = `<p class="error small">${esc(e.message)}</p>`; return null; });
        if (!index) return;
        if (!q.trim()) {
          // recent foods from the diary
          const seen = new Set();
          list = store.all('meal').filter((m) => m.source?.type === 'food' && m.food).sort((a, b) => (b.day + (b.t || '')).localeCompare(a.day + (a.t || '')))
            .map((m) => m.food).filter((f) => !seen.has(f.id) && seen.add(f.id)).slice(0, 12);
          res.innerHTML = list.length ? `<p class="tiny muted" style="margin:8px 2px 0">Recent</p>${list.map((f, i) => foodRow(f, i)).join('')}`
            : '<p class="small muted" style="padding:12px 2px">Type to search ~450 common foods, or search Open Food Facts for branded products.</p>';
        } else {
          list = search(index, q, 25).map((r) => r.food);
          res.innerHTML = list.length ? list.map((f, i) => foodRow(f, i)).join('') : '<p class="small muted" style="padding:12px 2px">Nothing in the built-in table. Try Open Food Facts below.</p>';
        }
        drawOff();
      };
      const drawOff = () => {
        const box = $('#fd-off', el);
        if (!q.trim()) { box.innerHTML = ''; return; }
        if (off === null) box.innerHTML = `<button class="soft block" id="fd-offbtn">${icon('search')} Search Open Food Facts for “${esc(q.trim())}”</button>`;
        else if (off === 'loading') box.innerHTML = '<div class="card center"><div class="spinner" style="margin:6px auto"></div><p class="small muted">Searching Open Food Facts…</p></div>';
        else if (off instanceof Error) box.innerHTML = `<div class="card"><p class="small error">${esc(off.message)}</p></div>`;
        else box.innerHTML = `<p class="section-title" style="margin-top:6px">Open Food Facts</p><div class="card" style="padding-top:4px;padding-bottom:4px">${off.length ? off.map((f, i) => foodRow(f, 1000 + i)).join('') : '<p class="small muted" style="padding:12px 2px">No products found.</p>'}</div>`;
        const b = $('#fd-offbtn', box);
        if (b) b.onclick = async () => {
          const term = q.trim();
          off = 'loading'; drawOff();
          try { off = await searchOFF(term); } catch (e) { off = e; }
          if (q.trim() === term) drawOff();
        };
      };
      let timer;
      input.oninput = () => { q = input.value; off = null; clearTimeout(timer); timer = setTimeout(draw, 120); };
      el.onclick = (e) => {
        const b = e.target.closest('.fd-food');
        if (!b) return;
        const i = Number(b.dataset.i);
        result = i >= 1000 ? off[i - 1000] : list[i];
        s.close();
      };
      $('#fd-custom', el).onclick = async () => {
        const f = await customFoodForm({ name: q });
        if (f) { result = f; s.close(); }
      };
      draw();
      if (!q) setTimeout(() => input.focus(), 250);
    }, { onClose: () => resolve(result) });
  });
}

// ---------- amount sheet ----------
// Resolves { grams, qty, unit } or null. `extra` renders under the title (e.g. meal select).
export function amountSheet(food, { title, grams = 100, qty, unit, ok = 'Add', danger = null } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const opts = unitOptions(food);
    let u = opts.find((o) => o.key === unit) ? unit : 'g';
    let q = qty ?? (u === 'g' ? grams : 1);
    push((el, s) => {
      el.innerHTML = sheet({ title: title || (food.src === 'db' ? food.en : food.name), body: `
        <p class="small muted center" style="margin:-6px 0 12px">${food.src === 'db' ? esc(food.pl) + ' · ' : ''}${n0(food.k)} kcal per 100 g</p>
        <div class="form-row"><label>Amount<input id="fd-q" inputmode="decimal" value="${esc(String(Math.round(q * 100) / 100))}"></label>
        <label>Unit<select id="fd-u">${opts.map((o) => `<option value="${o.key}" ${o.key === u ? 'selected' : ''}>${esc(o.label)}${o.key !== 'g' && o.key !== 'ml' ? ` (${n1(o.grams)} g)` : ''}</option>`).join('')}</select></label></div>
        <div class="card flat fd-amt" id="fd-m" style="margin:14px 0"></div>
        <div class="sheet-actions">${danger ? `<button class="ghost danger-text" data-a="del">${esc(danger)}</button>` : '<button class="ghost" data-a="no">Cancel</button>'}
        <button class="primary" data-a="ok">${esc(ok)}</button></div>` });
      const upd = () => {
        const n = parseNum($('#fd-q', el).value);
        u = $('#fd-u', el).value;
        const g = n == null ? null : n * (opts.find((o) => o.key === u)?.grams || 1);
        const m = macrosFor(food, g || 0);
        $('#fd-m', el).innerHTML = g == null ? '<p class="small muted">Enter an amount</p>' : `<div class="row between"><span class="muted small">${n1(g)} g</span><span>${macroLine(m)}</span></div>`;
        $('[data-a=ok]', el).disabled = !(g > 0);
        return { g, n };
      };
      $('#fd-q', el).oninput = upd;
      $('#fd-u', el).onchange = () => {
        const nu = $('#fd-u', el).value;
        if (nu !== 'g' && u === 'g') $('#fd-q', el).value = '1';
        if (nu === 'g' && u !== 'g') $('#fd-q', el).value = String(Math.round((parseNum($('#fd-q', el).value) || 1) * (opts.find((o) => o.key === u)?.grams || 1)));
        upd();
      };
      $('[data-a=ok]', el).onclick = () => { const { g, n } = upd(); if (g > 0) { result = { grams: Math.round(g * 10) / 10, qty: n, unit: u }; s.close(); } };
      $('[data-a=no]', el)?.addEventListener('click', () => s.close());
      $('[data-a=del]', el)?.addEventListener('click', () => { result = { remove: true }; s.close(); });
      upd();
      setTimeout(() => { const i = $('#fd-q', el); i.focus(); i.select(); }, 250);
    }, { sheet: true, onClose: () => resolve(result) });
  });
}

// ---------- custom food ----------
export function customFoodForm(prefill = {}) {
  return new Promise((resolve) => {
    let result = null;
    const f = { name: '', brand: '', k: '', p: '', c: '', f: '', portion: '', ...prefill };
    const portionG = f.u?.piece || f.u?.serving || '';
    push((el, s) => {
      el.innerHTML = page({ title: f.id ? 'Edit my food' : 'New food', right: `<button class="primary" id="fd-save">Save</button>`, body: `
        <form class="form" id="fd-form" onsubmit="return false">
          <label>Name<input name="name" value="${esc(f.name)}" placeholder="e.g. Twaróg półtłusty Piątnica" required></label>
          <label>Brand (optional)<input name="brand" value="${esc(f.brand || '')}"></label>
          <p class="section-title" style="margin:6px 2px 0">Per 100 g (from the label)</p>
          <div class="form-row"><label>Calories (kcal)<input name="k" inputmode="decimal" value="${esc(f.k)}" required></label>
          <label>Protein (g)<input name="p" inputmode="decimal" value="${esc(f.p)}"></label></div>
          <div class="form-row"><label>Carbs (g)<input name="c" inputmode="decimal" value="${esc(f.c)}"></label>
          <label>Fat (g)<input name="f" inputmode="decimal" value="${esc(f.f)}"></label></div>
          <label>One piece / serving weighs (g, optional)<input name="piece" inputmode="decimal" value="${esc(portionG)}" placeholder="e.g. 60 for one egg"></label>
          <p class="error small" hidden></p>
          ${f.id ? '<button type="button" class="ghost danger-text" id="fd-del">Delete this food</button>' : ''}
        </form>` });
      $('#fd-save', el).onclick = async () => {
        const fm = $('#fd-form', el);
        const v = (n) => parseNum(fm[n].value);
        const err = $('.error', fm);
        if (!fm.name.value.trim() || v('k') == null) { err.textContent = 'Name and calories are needed.'; err.hidden = false; return; }
        const item = { ...(f.id && f.src === 'custom' ? { id: f.id } : {}), name: fm.name.value.trim(), brand: fm.brand.value.trim() || null,
          k: v('k'), p: v('p') || 0, c: v('c') || 0, f: v('f') || 0 };
        if (v('piece') > 0) item.u = { piece: v('piece') };
        const saved = await store.put('food', item);
        result = { ...saved, src: 'custom' };
        toast('Food saved');
        s.close();
      };
      $('#fd-del', el)?.addEventListener('click', async () => { await store.remove(f.id); toast('Deleted'); s.close(); });
      if (!f.name) setTimeout(() => $('input[name=name]', el).focus(), 250);
    }, { onClose: () => resolve(result) });
  });
}

export function foodSubline(f) {
  return f.src === 'db' ? esc(f.pl || '') : esc(f.brand || (f.src === 'off' ? 'Open Food Facts' : 'My food'));
}
export { $, $$, esc, icon, toast };
