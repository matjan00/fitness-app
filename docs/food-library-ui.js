// Food tab > Library: browse by cuisine -> course, filters, "Fits my day", recipe detail, favourites, "cooked it", add to diary.
// Data + pure logic: food-library.js. Favourites and ratings live in one config object: store.getConfig('library').
import { $, $$, esc, icon, toast, n0, local, today } from './util.js';
import * as store from './store.js';
import { push, page, sheet, confirmSheet } from './nav.js';
import { sumEntries } from './food-calc.js';
import { targets, img } from './food-ui.js';
import { logRecipe, editRecipe, recipePer } from './food-recipes.js';
import { findCopy, copiesByLib, libToOwn, withTotals } from './food-copy.js';
import { checkCardHtml, ingListHtml, bindEditing, foodsMap } from './food-edit-ui.js';
import { checkRecipe } from './food-check.js';
import { catLabel } from './food-cats.js';
import {
  CUISINES, COURSES, cuisineOf, courseLabel, SOURCE_LABEL, loadLibrary, filterRecipes, fitsMyDay, displayIngredient, totalMin, toggleFav, markCooked,
} from './food-library.js';

const state = () => store.getConfig('library', { favs: [], cooked: {} });
const favSet = () => new Set(state().favs || []);
const saveState = (s) => store.setConfig('library', { favs: s.favs || [], cooked: s.cooked || {} });

const F0 = { cuisine: null, course: null, q: '', maxTime: 0, difficulty: null, main: null, veg: false, maxKcal: 0, minP: 0, fav: false };
const getNav = () => ({ ...F0, ...local.get('lib-nav', {}) });
const setNav = (n) => local.set('lib-nav', n);
const filterCount = (n) => ['maxTime', 'difficulty', 'main', 'veg', 'maxKcal', 'minP', 'fav'].filter((k) => n[k]).length;

// Thumbnail for cards. TheMealDB serves smaller sizes by suffix.
const thumb = (r) => (r.image && r.image.includes('themealdb.com') ? `${r.image}/medium` : r.image);
function tile(r, cls = '') {
  if (!r.image) return `<div class="fd-img fd-libph ${cls}" data-c="${esc(r.cuisine)}"><span>${cuisineOf(r.cuisine).emoji}</span></div>`;
  return img(thumb(r), cls);
}
const dayEntries = () => store.all('meal').filter((e) => e.day === today());
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

function card(r, favs, copy) {
  const c = state().cooked?.[r.id];
  const ps = copy ? recipePer(copy) : r.per_serving;
  return `<button class="fd-rcard" data-lid="${esc(r.id)}">${tile(r)}
    <div class="fd-rcard-body"><b class="fd-2l">${favs.has(r.id) ? '♥ ' : ''}${esc(r.title)}</b>
      <span class="small muted">${n0(ps.kcal)} kcal · <span class="fd-p">${n0(ps.p)} g P</span></span>
      <span class="tiny muted">${totalMin(r)} min${c ? ` · ${stars(c.rating)}` : ''} · ${copy ? '<span class="fd-badge mine">Your version</span>' : `<span class="fd-badge">${esc(SOURCE_LABEL[r.source.type] || r.source.name)}</span>`}</span></div></button>`;
}

export async function renderLibrary(box) {
  box.innerHTML = '<div class="card empty" style="margin-top:14px"><p class="small muted">Loading recipes…</p></div>';
  let lib;
  try { lib = await loadLibrary(); } catch (e) {
    box.innerHTML = `<div class="card empty" style="margin-top:14px">${icon('info')}<h2>Library not available</h2><p class="small">Open the app once with a connection to download it.</p></div>`;
    return;
  }
  draw(box, lib);
}

function draw(box, lib) {
  const nav = getNav();
  const favs = favSet();
  const copies = copiesByLib(store.all('recipe'));
  const all = lib.recipes;
  const active = nav.cuisine || nav.q || filterCount(nav);
  const fc = filterCount(nav);
  const list = filterRecipes(all, nav, favs);
  const t = targets();
  let fits = [];
  if (t && !active) {
    const s = sumEntries(dayEntries());
    fits = fitsMyDay(all, { kcal: t.kcal - s.kcal, p: t.p - s.p });
  }
  const counts = {};
  for (const r of all) counts[r.cuisine] = (counts[r.cuisine] || 0) + 1;
  const cuisines = [...CUISINES.filter((c) => counts[c.key]), ...Object.keys(counts).filter((k) => !CUISINES.some((c) => c.key === k)).map(cuisineOf)];
  const courseKeys = COURSES.filter((c) => filterRecipes(all, { ...nav, course: null }, favs).some((r) => r.course === c.key));

  box.innerHTML = `
    <div class="row" style="gap:8px"><div class="search grow">${icon('search')}<input id="lib-q" type="search" placeholder="Search dishes or ingredients" value="${esc(nav.q)}"></div>
      <button class="ghost" id="lib-filters" style="padding:12px 14px">Filters${fc ? ` · ${fc}` : ''}</button></div>
    ${fits.length ? `<div class="card fd-fits" style="margin-top:12px"><div class="card-head" style="margin-bottom:8px"><div><h2>Fits my day</h2><p class="tiny muted">Works with what is left today</p></div></div>
      <div class="chips fd-fitrow">${fits.map((r) => `<button class="fd-fit" data-lid="${esc(r.id)}"><b class="fd-2l">${esc(r.title)}</b><span class="tiny muted">${n0(r.per_serving.kcal)} kcal · ${n0(r.per_serving.p)} g P</span></button>`).join('')}</div></div>` : ''}
    ${!active ? `<div class="fd-grid fd-cuisines">${cuisines.map((c) => `<button class="fd-rcard fd-cui" data-cui="${c.key}"><span class="fd-cui-e">${c.emoji}</span><b>${esc(c.label)}</b><span class="small muted">${counts[c.key]} recipe${counts[c.key] > 1 ? 's' : ''}</span></button>`).join('')}
        <button class="fd-rcard fd-cui" data-fav="1"><span class="fd-cui-e">♥</span><b>Favourites</b><span class="small muted">${favs.size} saved</span></button></div>`
      : `<div class="row" style="margin-top:12px;gap:8px"><button class="link" id="lib-back">‹ All cuisines</button><b class="grow" style="text-align:right">${nav.cuisine ? esc(cuisineOf(nav.cuisine).label) : 'Results'} · ${list.length}</b></div>
        <div class="chips" style="margin-top:6px"><button class="chip ${!nav.course ? 'on' : ''}" data-course="">All</button>${courseKeys.map((c) => `<button class="chip ${nav.course === c.key ? 'on' : ''}" data-course="${c.key}">${esc(c.label)}</button>`).join('')}</div>
        ${list.length ? `<div class="fd-grid">${list.map((r) => card(r, favs, copies.get(r.id))).join('')}</div>` : '<div class="card empty" style="margin-top:14px">No recipes match. Try fewer filters.</div>'}`}`;

  const inp = $('#lib-q', box);
  let timer;
  inp.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      setNav({ ...getNav(), q: inp.value });
      const pos = inp.selectionStart;
      draw(box, lib);
      const ni = $('#lib-q', box); ni.focus(); try { ni.setSelectionRange(pos, pos); } catch { /* search input */ }
    }, 200);
  };
  $('#lib-filters', box).onclick = () => openFilters(lib, () => draw(box, lib));
  $$('[data-cui]', box).forEach((b) => { b.onclick = () => { setNav({ ...getNav(), cuisine: b.dataset.cui, course: null }); draw(box, lib); }; });
  $('[data-fav]', box)?.addEventListener('click', () => { setNav({ ...F0, fav: true }); draw(box, lib); });
  $$('[data-course]', box).forEach((b) => { b.onclick = () => { setNav({ ...getNav(), course: b.dataset.course || null }); draw(box, lib); }; });
  $('#lib-back', box)?.addEventListener('click', () => { setNav({ ...F0 }); draw(box, lib); });
  $$('[data-lid]', box).forEach((b) => { b.onclick = () => openLibRecipe(b.dataset.lid, () => draw(box, lib)); });
}

// ---------- filters sheet ----------
function openFilters(lib, done) {
  push((el, s) => {
    const paint = () => {
      const n = getNav();
      const mains = [...new Set(lib.recipes.map((r) => r.main_ingredient).filter(Boolean))];
      const row = (label, key, opts) => `<div class="fd-frow"><p class="tiny muted">${label}</p><div class="chips" style="flex-wrap:wrap">${opts.map(([v, l]) => `<button class="chip ${(n[key] || (typeof v === 'number' ? 0 : null)) === v ? 'on' : ''}" data-k="${key}" data-v="${v}">${esc(l)}</button>`).join('')}</div></div>`;
      el.innerHTML = sheet({ title: 'Filters', body: `
        ${row('Total time', 'maxTime', [[0, 'Any'], [20, '≤ 20 min'], [30, '≤ 30 min'], [45, '≤ 45 min'], [60, '≤ 1 h']])}
        ${row('Difficulty', 'difficulty', [[null, 'Any'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']])}
        ${row('Main ingredient', 'main', [[null, 'Any'], ...mains.map((m) => [m, catLabel('main', m)])])}
        ${row('Calories per serving', 'maxKcal', [[0, 'Any'], [300, '≤ 300'], [500, '≤ 500'], [700, '≤ 700']])}
        ${row('Protein per serving', 'minP', [[0, 'Any'], [15, '≥ 15 g'], [25, '≥ 25 g'], [35, '≥ 35 g']])}
        <div class="fd-frow"><label class="switch"><span>Vegetarian only</span><input type="checkbox" id="lib-veg" ${n.veg ? 'checked' : ''}></label></div>
        <div class="fd-frow"><label class="switch"><span>Favourites only</span><input type="checkbox" id="lib-fav" ${n.fav ? 'checked' : ''}></label></div>
        <div class="sheet-actions"><button class="ghost" data-a="reset">Reset</button><button class="primary" data-a="ok">Show recipes</button></div>` });
      $$('[data-k]', el).forEach((b) => { b.onclick = () => {
        const v = b.dataset.v;
        setNav({ ...getNav(), [b.dataset.k]: v === 'null' ? null : /^\d+$/.test(v) ? Number(v) : v });
        paint();
      }; });
      $('#lib-veg', el).onchange = (e) => setNav({ ...getNav(), veg: e.target.checked });
      $('#lib-fav', el).onchange = (e) => setNav({ ...getNav(), fav: e.target.checked });
      $('[data-a=reset]', el).onclick = () => { const q = getNav().q; setNav({ ...F0, q }); paint(); };
      $('[data-a=ok]', el).onclick = () => s.close();
    };
    paint();
  }, { sheet: true, onClose: done });
}

// ---------- recipe detail ----------
export async function openLibRecipe(id, onBack) {
  const lib = await loadLibrary();
  const r = lib.recipes.find((x) => x.id === id);
  if (!r) return;
  const foods = await foodsMap();
  const getCopy = () => findCopy(store.all('recipe'), r.id);
  let servings = null;
  push((el, s) => {
    const paint = () => {
      const copy = getCopy();
      const rec = copy || libToOwn(r, foods); // one recipe shape: the personal copy, or an unsaved conversion of the original
      if (servings == null) servings = rec.servings;
      const k = servings / rec.servings;
      const fav = favSet().has(r.id);
      const c = state().cooked?.[r.id];
      const p = copy ? recipePer(copy) : r.per_serving;
      const missing = copy ? (copy.totals?.missing || 0) : (r.checks || 0);
      const warns = checkRecipe(rec.ingredients, rec.servings, foods);
      const cu = cuisineOf(r.cuisine);
      el.innerHTML = page({ title: rec.title, right: `<button class="icon-btn" id="lib-edit" aria-label="Edit">${icon('edit')}</button><button class="icon-btn ${fav ? 'on' : ''}" id="lib-fav" aria-label="Favourite" aria-pressed="${fav}">${icon('heart')}</button>`, body: `
        ${rec.image ? img(rec.image, 'fd-hero-img') : `<div class="fd-img fd-libph fd-hero-img" data-c="${esc(r.cuisine)}"><span>${cu.emoji}</span></div>`}
        <h2 class="fd-rtitle">${esc(rec.title)}</h2>${r.title_local ? `<p class="small muted">${esc(r.title_local)}</p>` : ''}
        ${copy ? `<div class="row between" style="margin:4px 0 8px"><span class="fd-badge mine">Your version</span><button class="link small" id="lib-reset">Reset to original</button></div>` : ''}
        <div class="fd-meta"><span>${icon('timer')} ${totalMin(r)} min${r.time_est ? ' (est.)' : ''}</span><span>${esc(r.difficulty)}</span><span>${cu.emoji} ${esc(cu.label)} · ${esc(courseLabel(r.course))}</span>${r.vegetarian ? '<span>Vegetarian</span>' : ''}
          ${r.video ? `<a href="${esc(r.video)}" target="_blank" rel="noopener noreferrer">${icon('play')} Video</a>` : ''}</div>
        <div class="card fd-totals" style="margin-top:14px"><div class="row between"><div><p class="tiny muted">Per serving</p><div class="fd-big">${n0(p.kcal)} <span>kcal</span></div></div>
          <div class="fd-pcf"><span class="fd-p">P ${n0(p.p)} g</span><span class="fd-c">C ${n0(p.c)} g</span><span class="fd-f">F ${n0(p.f)} g</span></div></div>
          ${missing ? `<p class="fd-warn small">${icon('info')} ${missing} ingredient${missing > 1 ? 's' : ''} could not be counted exactly.</p>` : ''}
          <button class="primary block" id="lib-log" style="margin-top:14px">${icon('plus')} Add to diary</button>
          <button class="ghost block" id="lib-cooked" style="margin-top:8px">${c ? `Cooked ${c.n}× · ${stars(c.rating)} · rate again` : 'I cooked it'}</button></div>
        ${checkCardHtml(warns)}
        <div class="row between" style="margin:18px 0 6px"><h3 class="section-title" style="margin:0">Ingredients</h3>
          <div class="fd-stepper"><button id="lib-minus" aria-label="Fewer servings">−</button><span><b>${servings}</b> serving${servings === 1 ? '' : 's'}</span><button id="lib-plus" aria-label="More servings">+</button></div></div>
        <div class="card"><div class="list">${ingListHtml(rec.ingredients, k)}</div></div>
        <p class="tiny muted" style="margin:6px 4px 0">Tap an ingredient to change the amount or the food${copy ? '' : ' - this saves your own version of the recipe'}.</p>
        <h3 class="section-title">Steps</h3><ol class="fd-steps">${rec.steps.map((st) => `<li>${esc(st)}</li>`).join('')}</ol>
        ${rec.notes ? `<h3 class="section-title">Notes</h3><div class="card"><p style="white-space:pre-wrap">${esc(rec.notes)}</p></div>` : ''}
        <p class="tiny muted" style="margin-top:16px">Source: <a href="${esc(r.source.url)}" target="_blank" rel="noopener noreferrer">${esc(r.source.name)}</a>${r.source.author ? ` · ${esc(r.source.author)}` : ''}${r.source.year ? `, ${r.source.year}` : ''}<br>${esc(r.source.license)}</p>` });
      const commit = async (fn) => {
        const existed = getCopy();
        const cur = existed || libToOwn(r, foods);
        await store.put('recipe', withTotals(fn(cur)));
        if (!existed) toast('Saved as your version');
        paint();
      };
      bindEditing(el, { warns, foods, getRec: () => getCopy() || libToOwn(r, foods), commit });
      $('#lib-fav', el).onclick = async () => { await saveState(toggleFav(state(), r.id)); paint(); };
      $('#lib-minus', el).onclick = () => { servings = Math.max(1, servings - 1); paint(); };
      $('#lib-plus', el).onclick = () => { servings = Math.min(48, servings + 1); paint(); };
      $('#lib-cooked', el).onclick = () => cookedSheet(r, paint);
      $('#lib-log', el).onclick = () => logRecipe(copy || asLogRecipe(r));
      $('#lib-edit', el).onclick = async () => {
        let cp = getCopy();
        if (!cp) { cp = await store.put('recipe', libToOwn(r, foods)); toast('Saved as your version'); }
        editRecipe(cp, { id: cp.id });
      };
      $('#lib-reset', el)?.addEventListener('click', async () => {
        if (await confirmSheet('Delete your version and go back to the original recipe?', { ok: 'Reset to original', danger: true })) {
          await store.remove(copy.id); servings = null; toast('Back to the original'); paint();
        }
      });
    };
    paint();
  }, { onClose: onBack });
}

// The diary code expects a recipe-like object: id, title, servings and totals.
export function asLogRecipe(r) {
  const grams = r.ingredients.reduce((a, g) => a + (g.grams || 0), 0);
  return { id: r.id, title: r.title, lib: true, servings: 1, totals: { ...r.per_serving, grams: grams / r.servings } };
}

function cookedSheet(r, done) {
  let rating = state().cooked?.[r.id]?.rating || 4;
  push((el, s) => {
    const paint = () => {
      el.innerHTML = sheet({ title: 'How was it?', body: `<div class="fd-rate">${[1, 2, 3, 4, 5].map((n) => `<button data-n="${n}" class="${n <= rating ? 'on' : ''}" aria-label="${n} stars">★</button>`).join('')}</div>
        <div class="sheet-actions"><button class="ghost" data-a="no">Cancel</button><button class="primary" data-a="ok">Save</button></div>` });
      $$('[data-n]', el).forEach((b) => { b.onclick = () => { rating = Number(b.dataset.n); paint(); }; });
      $('[data-a=no]', el).onclick = () => s.close();
      $('[data-a=ok]', el).onclick = async () => { await saveState(markCooked(state(), r.id, rating, today())); toast('Saved'); s.close(); };
    };
    paint();
  }, { sheet: true, onClose: done });
}
