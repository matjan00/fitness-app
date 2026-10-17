// Food tab > Recipes: the one list of the user's own recipes - search, Add, quick chips (Favourites, meal), a Filters sheet
// (sort, time, main ingredient, technique, protein, calories, vegetarian) and "Fits my day". Tapping a card opens the
// recipe (food-recipes.js openRecipe), long-press deletes it. Pure logic: food-library.js (filters, Fits my day) and
// food-estimate.js (ownView, sorting). Favourites / ratings: food-favs.js.
import { $, $$, esc, icon, toast, n0, local, today, uid } from './util.js';
import * as store from './store.js';
import { push, sheet } from './nav.js';
import { sumEntries } from './food-calc.js';
import { dayTargets, img } from './food-ui.js';
import { recipePer, openRecipe, editRecipe, blankDraft, deleteRecipeFlow, unsavedDraft } from './food-recipes.js';
import { ownView, sortRecipes, SORTS, pp100 } from './food-estimate.js';
import { libToOwn } from './food-copy.js';
import { foodsMap } from './food-edit-ui.js';
import { CATEGORIES } from './food-cats.js';
import { filterRecipes, fitsMyDay, totalMin, planLibraryCleanup } from './food-library.js';
import { favSet, favState, forgetRecipe, stars } from './food-favs.js';

const F0 = { q: '', meal: null, technique: null, mains: [], maxTime: 0, veg: false, maxKcal: 0, minP: 0, fav: false, sort: 'default' };
const getNav = () => ({ ...F0, ...local.get('rec-nav', {}) });
const setNav = (n) => local.set('rec-nav', n);
const filterCount = (n) => ['maxTime', 'veg', 'maxKcal', 'minP', 'technique'].filter((k) => n[k]).length + (n.mains?.length ? 1 : 0) + (n.sort && n.sort !== 'default' ? 1 : 0);
const anyFilter = (n) => Boolean(n.q || n.meal || n.fav || filterCount(n));

const allRecipes = () => store.all('recipe').map((r) => ownView(r, recipePer));

function card(r, favs) {
  const c = favState().cooked?.[r.id];
  const ps = r.per_serving;
  const counted = ps.kcal > 0;
  return `<button class="fd-rcard${r.image ? '' : ' noimg'}" data-rid="${esc(r.rid)}">${r.image ? img(r.image) : ''}
    <div class="fd-rcard-body"><b class="fd-2l">${favs.has(r.id) ? '<span class="fd-heartmark" aria-label="Favourite">♥</span> ' : ''}${esc(r.title)}</b>
      ${counted ? `<span class="small muted">${n0(ps.kcal)} kcal · <span class="fd-p">${n0(ps.p)} g P</span></span>
      <span class="tiny muted">${n0(pp100(r))} g P / 100 kcal · ${totalMin(r)} min${c ? ` · ${stars(c.rating)}` : ''}</span>`
      : '<span class="small fd-warntext">Calories not counted yet</span>'}</div></button>`;
}

export function renderLibrary(box) {
  const nav = getNav();
  const favs = favSet();
  const all = allRecipes();
  if (!all.length) {
    box.innerHTML = `<div class="card empty" style="margin-top:14px">${icon('food')}<h2>No recipes yet</h2>
      <p class="small" style="margin:6px 0 14px">Paste a link from a recipe site, type one in, or save a meal from your diary (⋯ on a meal).</p>
      <button class="primary" id="rec-add2">${icon('plus')} Add a recipe</button></div>`;
    $('#rec-add2', box).onclick = () => editRecipe(blankDraft());
    return;
  }
  const liveFavs = all.filter((r) => favs.has(r.id)).length;
  const list = sortRecipes(filterRecipes(all, nav, favs), nav.sort);
  const meals = CATEGORIES.meal.items.filter((m) => all.some((r) => r.meals.includes(m.key)));
  const fc = filterCount(nav);

  let fitsHtml = '';
  const t = dayTargets(today());
  if (t && !anyFilter(nav)) {
    const s = sumEntries(store.all('meal').filter((e) => e.day === today()));
    const fits = fitsMyDay(all, { kcal: t.kcal - s.kcal, p: t.p - s.p });
    if (fits.list.length) {
      fitsHtml = `<div class="card fd-fits" style="margin-top:12px"><div class="card-head" style="margin-bottom:8px"><div><h2>Fits my day</h2><p class="tiny muted">For ${esc(CATEGORIES.meal.items.find((m) => m.key === fits.meal)?.label.toLowerCase() || 'your next meal')}, with ${n0(t.kcal - s.kcal)} kcal and ${n0(Math.max(0, t.p - s.p))} g protein left today</p></div></div>
        <div class="chips fd-fitrow">${fits.list.map((r) => `<button class="fd-fit" data-rid="${esc(r.rid)}"><b class="fd-2l">${esc(r.title)}</b><span class="tiny muted">${n0(r.per_serving.kcal)} kcal · ${n0(r.per_serving.p)} g P</span></button>`).join('')}</div></div>`;
    } else if (fits.over) {
      fitsHtml = `<div class="card flat small" style="margin-top:12px">${icon('info')} You've used today's calories (${n0(s.kcal - t.kcal)} kcal over), so there's nothing to suggest.</div>`;
    }
  }

  const draft = unsavedDraft();
  box.innerHTML = `
    ${draft ? `<div class="card flat small row between" style="margin-bottom:10px;gap:8px"><span>Unsaved recipe${draft.draft?.title ? `: <b>${esc(draft.draft.title)}</b>` : ''}</span>
      <span class="row" style="gap:6px"><button class="link" id="rec-draft-x">Discard</button><button class="primary small" id="rec-draft">Continue</button></span></div>` : ''}
    <div class="row" style="gap:8px"><div class="search grow">${icon('search')}<input id="rec-q" type="search" placeholder="Search recipes or ingredients" value="${esc(nav.q)}"></div>
      <button class="ghost" id="rec-filters" style="padding:12px 12px">Filters${fc ? ` · ${fc}` : ''}</button>
      <button class="primary" id="rec-add" style="padding:12px 12px" aria-label="Add a recipe">${icon('plus')}</button></div>
    <div class="chips" style="margin-top:10px"><button class="chip ${!nav.fav && !nav.meal ? 'on' : ''}" data-chip="all">All · ${all.length}</button>
      <button class="chip ${nav.fav ? 'on' : ''}" data-chip="fav">♥ Favourites · ${liveFavs}</button>
      ${meals.map((m) => `<button class="chip ${nav.meal === m.key ? 'on' : ''}" data-meal="${m.key}">${esc(m.label)}</button>`).join('')}</div>
    ${fitsHtml}
    ${list.length ? `<div class="fd-grid">${list.map((r) => card(r, favs)).join('')}</div>`
      : `<div class="card empty" style="margin-top:14px"><p>${nav.fav && !liveFavs ? 'No favourites yet - tap the heart on a recipe.' : 'No recipes match.'}</p>
        <button class="ghost" id="rec-clear" style="margin-top:10px">Clear search and filters</button></div>`}`;

  const inp = $('#rec-q', box);
  let timer;
  inp.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      setNav({ ...getNav(), q: inp.value });
      const pos = inp.selectionStart;
      renderLibrary(box);
      const ni = $('#rec-q', box); ni.focus(); try { ni.setSelectionRange(pos, pos); } catch { /* search input */ }
    }, 200);
  };
  $('#rec-filters', box).onclick = () => openFilters(all, () => renderLibrary(box));
  $('#rec-add', box).onclick = () => editRecipe(blankDraft());
  $('#rec-draft', box)?.addEventListener('click', () => { local.set('recipe-draft', null); editRecipe(draft.draft, { id: draft.id }); });
  $('#rec-draft-x', box)?.addEventListener('click', () => { local.set('recipe-draft', null); renderLibrary(box); });
  $('#rec-clear', box)?.addEventListener('click', () => { setNav({ ...F0 }); renderLibrary(box); });
  $$('[data-chip]', box).forEach((b) => { b.onclick = () => { const n = getNav(); setNav(b.dataset.chip === 'fav' ? { ...n, fav: !n.fav, meal: null } : { ...n, fav: false, meal: null }); renderLibrary(box); }; });
  $$('[data-meal]', box).forEach((b) => { b.onclick = () => { const n = getNav(); setNav({ ...n, fav: false, meal: n.meal === b.dataset.meal ? null : b.dataset.meal }); renderLibrary(box); }; });
  $$('.fd-fit[data-rid]', box).forEach((b) => { b.onclick = () => openRecipe(b.dataset.rid); });
  $$('.fd-rcard[data-rid]', box).forEach((b) => {
    // long-press a recipe (or right-click) to delete it
    let t2 = null; let fired = false;
    const cancel = () => clearTimeout(t2);
    b.addEventListener('pointerdown', () => { fired = false; t2 = setTimeout(() => { fired = true; deleteRecipeFlow(b.dataset.rid); }, 600); });
    ['pointerup', 'pointerleave', 'pointercancel', 'pointermove'].forEach((ev) => b.addEventListener(ev, cancel));
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); });
    b.onclick = () => { if (fired) { fired = false; return; } openRecipe(b.dataset.rid); };
  });
}

// ---------- filters sheet ----------
function openFilters(all, done) {
  push((el, s) => {
    const paint = () => {
      const n = getNav();
      const mains = CATEGORIES.main.items.filter((m) => all.some((r) => r.mains.includes(m.key)));
      const techs = CATEGORIES.technique.items.filter((m) => all.some((r) => r.techs.includes(m.key)));
      const row = (label, key, opts) => `<div class="fd-frow"><p class="tiny muted">${label}</p><div class="chips" style="flex-wrap:wrap">${opts.map(([v, l]) => `<button class="chip ${(n[key] || (typeof v === 'number' ? 0 : null)) === v ? 'on' : ''}" data-k="${key}" data-v="${v}">${esc(l)}</button>`).join('')}</div></div>`;
      el.innerHTML = sheet({ title: 'Filters', body: `
        ${row('Sort by', 'sort', SORTS.map(([k, l]) => [k, k === 'default' ? 'Newest' : l]))}
        ${row('Total time (estimated when not stated)', 'maxTime', [[0, 'Any'], [15, '≤ 15 min'], [30, '≤ 30 min'], [45, '≤ 45 min'], [60, '≤ 1 h']])}
        ${mains.length ? `<div class="fd-frow"><p class="tiny muted">Main ingredient (pick several)</p><div class="chips" style="flex-wrap:wrap"><button class="chip ${!n.mains.length ? 'on' : ''}" data-mainclear="1">Any</button>${mains.map((m) => `<button class="chip ${n.mains.includes(m.key) ? 'on' : ''}" data-main="${m.key}">${esc(m.label)}</button>`).join('')}</div></div>` : ''}
        ${techs.length ? row('Cooking', 'technique', [[null, 'Any'], ...techs.map((m) => [m.key, m.label])]) : ''}
        ${row('Protein per serving', 'minP', [[0, 'Any'], [20, '≥ 20 g'], [30, '≥ 30 g'], [40, '≥ 40 g']])}
        ${row('Calories per serving', 'maxKcal', [[0, 'Any'], [400, '≤ 400'], [600, '≤ 600'], [800, '≤ 800']])}
        <div class="fd-frow"><label class="switch"><span>Vegetarian only</span><input type="checkbox" id="rec-veg" ${n.veg ? 'checked' : ''}></label></div>
        <div class="sheet-actions"><button class="ghost" data-a="reset">Reset</button><button class="primary" data-a="ok">Show recipes</button></div>` });
      $$('[data-k]', el).forEach((b) => { b.onclick = () => {
        const v = b.dataset.v;
        setNav({ ...getNav(), [b.dataset.k]: v === 'null' ? null : /^\d+$/.test(v) ? Number(v) : v });
        paint();
      }; });
      $$('[data-main]', el).forEach((b) => { b.onclick = () => {
        const cur = new Set(getNav().mains);
        if (cur.has(b.dataset.main)) cur.delete(b.dataset.main); else cur.add(b.dataset.main);
        setNav({ ...getNav(), mains: [...cur] });
        paint();
      }; });
      $('[data-mainclear]', el)?.addEventListener('click', () => { setNav({ ...getNav(), mains: [] }); paint(); });
      $('#rec-veg', el).onchange = (e) => setNav({ ...getNav(), veg: e.target.checked });
      $('[data-a=reset]', el).onclick = () => { const { q, fav, meal } = getNav(); setNav({ ...F0, q, fav, meal }); paint(); };
      $('[data-a=ok]', el).onclick = () => s.close();
    };
    paint();
  }, { sheet: true, onClose: done });
}

// ---------- retiring the bulk-imported library ----------
// The bulk-imported library is retired (food-library.js planLibraryCleanup): favourited / cooked imports become own
// recipes, the rest is deleted. Runs whenever synced library records are present (app.js), but only after a sync has
// finished, so a second device first receives the recipes the first device already moved instead of copying them again.
let cleaning = null;
// The own recipe made from library record X always gets the same id on every device (uuid-shaped SHA-1 of X).
async function ownIdFor(libId) {
  try {
    const h = [...new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`own-recipe:${libId}`)))].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
  } catch { return uid(); }
}
export function cleanUpLibrary() {
  if (cleaning || !store.all('library').length || store.syncState().status === 'syncing') return cleaning;
  cleaning = (async () => {
    const foods = await foodsMap();
    const lib = store.all('library');
    const ids = new Map(await Promise.all(lib.map(async (r) => [r.id, await ownIdFor(r.id)])));
    const plan = planLibraryCleanup(lib, store.all('recipe'), favState(), store.all('meal'), (r) => libToOwn(r, foods), (r) => ids.get(r.id));
    if (plan.put.length) await store.putMany('recipe', plan.put);
    if (plan.entries.length) await store.putMany('meal', plan.entries);
    await store.setConfig('library', plan.state);
    await store.removeMany(plan.remove);
    if (plan.put.length) toast(`Kept ${plan.put.length} recipe${plan.put.length > 1 ? 's' : ''} you liked in Recipes`);
  })().catch((e) => console.error(e)).finally(() => { cleaning = null; });
  return cleaning;
}

export { forgetRecipe };
