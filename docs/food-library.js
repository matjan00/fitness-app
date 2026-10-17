// Recipe LIBRARY: one recipe format for every source (TheMealDB, later imports; own recipes are shown through the same shape by food-estimate.js).
// Pure logic + data loading (no DOM). The screens live in food-library-ui.js. Tests: tests/food-library.test.js.
//
// -- Library recipe format (all units metric: g, ml, deg C; text in English) --
// {
//   id            unique, stable. Private library records (Supabase kind 'library'): the record's uuid (uuid5 of user:library:source:source_id);
//                 `key` 'source:source_id' is the human-readable form. Static files (none any more) used 'mealdb-52982'.
//   title, title_local?            (title_local = original-language name, e.g. Polish)
//   cuisine       'italian' | 'french' | 'polish' | 'american' | 'international' | ...
//   course        'breakfast' | 'starter' | 'soup' | 'main' | 'side' | 'dessert' | 'snack' | 'baking'
//   servings      number >= 1
//   prep_min, cook_min   minutes (total = prep + cook)
//   est           { main?, time?, servings? } true where the value was ESTIMATED, not stated by the source (food-estimate.js)
//   difficulty    'easy' | 'medium' | 'hard'
//   vegetarian    boolean
//   main_ingredient      a food-cats "main" id (chicken, beef, pasta, rice, veggies, ...) or null
//   ingredients   [{ text, qty, unit, name, grams, food_id, conf }]
//                 text = original line; grams = weight for the WHOLE recipe (null when unknown);
//                 food_id = row in data/foods.json (null when unmatched); conf = 'high'|'medium'|'low'|'check'
//                 ('check' = unmatched or grams guessed, a human should look). No grams/food = not counted in macros.
//   steps         [string]
//   per_serving   { kcal, p, c, f }  computed with the app's own food table - same method for every source
//   checks        number of ingredients flagged 'check' (quality signal)
//   image, video  urls or null
//   source        { type: 'mealdb'|'bbcgoodfood'|'skinnytaste'|'budgetbytes'|'pinchofyum'|'ethan', name, url, author?, license }
//   nutrition_basis?      'published' = per_serving is what the source site publishes (JSON-LD), 'computed' = from our ingredient table
//   computed_per_serving? our computed { kcal, p, c, f } kept next to published numbers; source_nutrition? the published numbers
//   key?          'source:source_id' (dedupe / debugging)
//   notes?
// }
import { fold } from './food-parse.js';

export const CUISINES = [
  { key: 'italian', label: 'Italian', emoji: '\u{1F1EE}\u{1F1F9}' },
  { key: 'french', label: 'French', emoji: '\u{1F1EB}\u{1F1F7}' },
  { key: 'polish', label: 'Polish', emoji: '\u{1F1F5}\u{1F1F1}' },
  { key: 'american', label: 'American', emoji: '\u{1F1FA}\u{1F1F8}' },
  { key: 'international', label: 'International', emoji: '\u{1F30D}' },
];
export const cuisineOf = (key) => CUISINES.find((c) => c.key === key) || { key, label: key ? key[0].toUpperCase() + key.slice(1) : 'Other', emoji: '\u{1F37D}\u{FE0F}' };

export const COURSES = [
  { key: 'breakfast', label: 'Breakfast' }, { key: 'starter', label: 'Starter' }, { key: 'soup', label: 'Soup' }, { key: 'main', label: 'Main' },
  { key: 'side', label: 'Side' }, { key: 'dessert', label: 'Dessert' }, { key: 'snack', label: 'Snack' }, { key: 'baking', label: 'Baking' },
];
export const courseLabel = (k) => COURSES.find((c) => c.key === k)?.label || k;
export const DIFFICULTIES = ['easy', 'medium', 'hard'];
export const SOURCE_LABEL = { mealdb: 'TheMealDB', themealdb: 'TheMealDB', bbcgoodfood: 'BBC Good Food', skinnytaste: 'Skinnytaste', budgetbytes: 'Budget Bytes', pinchofyum: 'Pinch of Yum', ethan: 'Ethan Chlebowski', myplate: 'MyPlate', own: 'My recipes' };

// ---------- validation (used by tests for every JSON file, and by the build script) ----------
export function validateRecipe(r) {
  const e = [];
  const need = (ok, msg) => { if (!ok) e.push(msg); };
  need(r && typeof r.id === 'string' && r.id, 'id');
  need(typeof r.title === 'string' && r.title, 'title');
  need(typeof r.cuisine === 'string' && r.cuisine, 'cuisine');
  need(COURSES.some((c) => c.key === r.course), `course ${r.course}`);
  need(Number.isFinite(r.servings) && r.servings >= 1, 'servings');
  need(Number.isFinite(r.prep_min) && r.prep_min >= 0, 'prep_min');
  need(Number.isFinite(r.cook_min) && r.cook_min >= 0, 'cook_min');
  need(DIFFICULTIES.includes(r.difficulty), 'difficulty');
  need(typeof r.vegetarian === 'boolean', 'vegetarian');
  need(r.main_ingredient === null || typeof r.main_ingredient === 'string', 'main_ingredient');
  need(Array.isArray(r.ingredients) && r.ingredients.length > 0, 'ingredients');
  for (const [i, g] of (r.ingredients || []).entries()) {
    need(typeof g.text === 'string' && g.text, `ingredient ${i} text`);
    need(g.grams === null || (Number.isFinite(g.grams) && g.grams >= 0), `ingredient ${i} grams`);
    need(g.food_id === null || typeof g.food_id === 'string', `ingredient ${i} food_id`);
    need(['high', 'medium', 'low', 'check'].includes(g.conf), `ingredient ${i} conf`);
  }
  need(Array.isArray(r.steps) && r.steps.length > 0 && r.steps.every((s) => typeof s === 'string' && s), 'steps');
  const p = r.per_serving;
  need(p && ['kcal', 'p', 'c', 'f'].every((k) => Number.isFinite(p[k]) && p[k] >= 0), 'per_serving');
  need(r.est === undefined || (r.est && typeof r.est === 'object'), 'est');
  need(r.image === null || typeof r.image === 'string', 'image');
  need(r.video === null || typeof r.video === 'string', 'video');
  const s = r.source;
  need(s && typeof s.type === 'string' && s.type && s.name && /^https?:\/\//.test(s.url || '') && s.license, 'source');
  return e;
}

// ---------- scaling ----------
const trimNum = (x) => String(Math.round(x * 100) / 100);
// Ingredient line for a scale factor k (k = wanted servings / recipe servings). Matched rows show grams, others scale their own qty.
export function displayIngredient(ing, k) {
  if (ing.grams != null && ing.grams > 0) {
    const g = ing.grams * k;
    return `${g >= 10 ? Math.round(g) : Math.round(g * 10) / 10} g ${ing.name || ing.text}`;
  }
  if (ing.qty != null && k !== 1) return `${trimNum(ing.qty * k)}${ing.unit ? ` ${ing.unit}` : ''} ${ing.name || ing.text}`;
  return ing.text;
}

// ---------- filtering ----------
export const totalMin = (r) => (r.prep_min || 0) + (r.cook_min || 0);
// f: { q, cuisine, course, meal, technique, maxTime, difficulty, mains: [ids] (any of), source, veg, maxKcal, minP, fav }; favs: Set of ids.
// A recipe can have several main ingredients / meals / techniques (r.mains, r.meals, r.techs from ownView); the single
// main_ingredient is the fallback. Recipes whose calories are not counted yet (kcal 0) never pass a kcal / protein filter.
const has = (list, single, k) => (list?.length ? list.includes(k) : single === k);
export function filterRecipes(list, f = {}, favs = new Set()) {
  const q = fold(f.q || '').trim();
  const mains = f.mains?.length ? f.mains : f.main ? [f.main] : [];
  return list.filter((r) => {
    if (f.cuisine && r.cuisine !== f.cuisine) return false;
    if (f.course && r.course !== f.course) return false;
    if (f.meal && !r.meals?.includes(f.meal)) return false;
    if (f.technique && !r.techs?.includes(f.technique)) return false;
    if (f.maxTime && totalMin(r) > f.maxTime) return false;
    if (f.difficulty && r.difficulty !== f.difficulty) return false;
    if (mains.length && !mains.some((m) => has(r.mains, r.main_ingredient, m))) return false;
    if (f.source && r.source?.type !== f.source) return false;
    if (f.veg && !r.vegetarian) return false;
    const kcal = r.per_serving?.kcal || 0;
    if (f.maxKcal && !(kcal > 0 && kcal <= f.maxKcal)) return false;
    if (f.minP && !(kcal > 0 && (r.per_serving?.p || 0) >= f.minP)) return false;
    if (f.fav && !favs.has(r.id)) return false;
    if (q) {
      const ings = (r.ingredients || []).map((i) => `${i.name || i.text || ''} ${i.food?.name || ''} ${i.food?.en || ''} ${i.food?.pl || ''}`).join(' ');
      if (!fold(`${r.title} ${r.title_local || ''} ${ings}`).includes(q)) return false;
    }
    return true;
  });
}

// The meal that is next / now by the clock, and how many meals are still to come today (incl. this one).
export function mealNow(hour) {
  const h = Number(hour);
  if (h < 11) return { meal: 'breakfast', left: 3 };
  if (h < 16) return { meal: 'lunch', left: 2 };
  if (h < 21) return { meal: 'dinner', left: 1 };
  return { meal: 'snack', left: 1 };
}

// "Fits my day": recipes for the next meal, sized to what is left of today's kcal split over the meals still to come,
// favouring protein. remaining: { kcal, p }; opts: { hour } (local clock). Recipes with uncounted calories are skipped.
// Returns { list, over } - over = true when today's calories are already used up.
export function fitsMyDay(list, remaining, { hour = new Date().getHours(), limit = 6 } = {}) {
  const remK = remaining?.kcal ?? 0;
  if (!(remK >= 150)) return { list: [], over: remK < 0 };
  const { meal, left } = mealNow(hour);
  const budget = remK / left; // kcal this meal should be about
  const remP = Math.max(remaining.p || 0, 1);
  const pBudget = remP / left;
  const out = list
    .filter((r) => r.per_serving?.kcal > 0 && r.per_serving.kcal <= remK * 1.05 && r.per_serving.kcal >= Math.min(budget * 0.4, 250))
    .map((r) => {
      const k = r.per_serving.kcal;
      let score = Math.min(r.per_serving.p / pBudget, 1.2) * 1.5 - Math.abs(1 - k / budget) * 1.2;
      if (r.meals?.length) score += r.meals.includes(meal) ? 0.4 : r.meals.every((m) => m === 'breakfast') ? -0.8 : 0;
      return { r, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.r);
  return { list: out, over: false, meal };
}

// ---------- user state: one config object { favs: [ids], cooked: { id: { rating, n, last } } } ----------
export function toggleFav(state, id) {
  const favs = new Set(state.favs || []);
  if (favs.has(id)) favs.delete(id); else favs.add(id);
  return { ...state, favs: [...favs] };
}
export function markCooked(state, id, rating, day) {
  const prev = state.cooked?.[id] || { n: 0 };
  return { ...state, cooked: { ...(state.cooked || {}), [id]: { rating, n: (prev.n || 0) + 1, last: day } } };
}

// ---------- retiring the bulk-imported library (2026-10) ----------
// The imported library is gone: recipes are now added one at a time as own recipes. Imported recipes the user favourited
// or cooked (and any "Your version" copy) become plain own recipes; every library record is then deleted.
// lib: library recipes (store.all('library')); own: store.all('recipe'); state: config 'library' { favs, cooked };
// entries: diary meals; toOwn(lib) -> own recipe without id (food-copy libToOwn); newId(lib) -> id for its own recipe.
// Returns { put: [own recipes with id], entries: [diary entries re-pointed to the own recipe], state, remove: [library ids] }.
// Safe to run again (e.g. on a partial sync): a recipe already moved is found by `imported_from`.
export function planLibraryCleanup(lib, own, state = {}, entries = [], toOwn, newId) {
  const favs = new Set(state.favs || []);
  const cooked = { ...(state.cooked || {}) };
  const byLib = new Map();
  for (const r of own) { const k = r.imported_from || r.from_library; if (k) byLib.set(k, r); }
  const put = [];
  const idMap = new Map(); // library id -> own recipe id
  for (const r of lib) {
    const copy = byLib.get(r.id);
    const keep = copy || favs.has(r.id) || cooked[r.id];
    if (!keep) continue;
    if (copy) {
      const { from_library: _fl, ...rest } = copy;
      if (copy.from_library) put.push({ ...rest, imported_from: r.id });
      idMap.set(r.id, copy.id);
    } else {
      const { from_library: _fl, ...rest } = toOwn(r);
      const rec = { ...rest, id: newId(r), imported_from: r.id };
      put.push(rec);
      idMap.set(r.id, rec.id);
    }
  }
  // Favourites / ratings follow the recipe (own recipes are listed with id 'own-<id>').
  const ownKey = (libId) => `own-${idMap.get(libId)}`;
  const nextFavs = [...favs].map((id) => (idMap.has(id) ? ownKey(id) : id));
  const nextCooked = {};
  for (const [id, v] of Object.entries(cooked)) nextCooked[idMap.has(id) ? ownKey(id) : id] = v;
  const moved = entries.filter((e) => e.source?.type === 'library' && idMap.has(e.source.id))
    .map((e) => ({ ...e, source: { ...e.source, type: 'recipe', id: idMap.get(e.source.id) } }));
  return { put, entries: moved, state: { favs: [...new Set(nextFavs)], cooked: nextCooked }, remove: lib.map((r) => r.id) };
}

// ---------- loading ----------
// Third-party recipes used to be bulk-imported as private records of kind 'library' (scripts/library/import.mjs). That
// import is retired and planLibraryCleanup() empties the kind; the loaders stay so leftover records still show until then.
// Optional static files under data/library/ (index.json + one file per source) are still merged in when present.
const usable = (r) => r && typeof r.title === 'string' && r.title && Array.isArray(r.ingredients) && r.ingredients.length && Array.isArray(r.steps) && r.per_serving && r.source;
export function mergeLibrary(staticRecipes = [], records = []) {
  const seen = new Set();
  const out = [];
  for (const r of [...records, ...staticRecipes]) {
    if (!usable(r)) continue;
    const key = r.key || r.id;
    if (seen.has(r.id) || seen.has(key)) continue;
    seen.add(r.id); seen.add(key);
    out.push(r);
  }
  return out;
}
let staticCache = null;
function loadStatic(base) {
  if (!staticCache) {
    staticCache = fetch(`${base}index.json`).then((r) => (r.ok ? r.json() : { sources: [] })).catch(() => ({ sources: [] }))
      .then(async (idx) => {
        const parts = await Promise.all((idx.sources || []).map((s) => fetch(`${base}${s.file}`).then((r) => (r.ok ? r.json() : { recipes: [] })).catch(() => ({ recipes: [] }))));
        return { index: idx, recipes: parts.flatMap((p) => p.recipes || []) };
      });
  }
  return staticCache;
}
// records: store.all('library') (private, synced). Always resolves; an empty library means "not imported yet".
export async function loadLibrary(records = [], base = 'data/library/') {
  const st = await loadStatic(base);
  return { index: st.index, recipes: mergeLibrary(st.recipes, records) };
}
