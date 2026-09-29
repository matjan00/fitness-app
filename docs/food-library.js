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
// f: { q, cuisine, course, maxTime, difficulty, mains: [ids] (any of), source, veg, maxKcal, minP, fav }; favs: Set of ids
export function filterRecipes(list, f = {}, favs = new Set()) {
  const q = fold(f.q || '').trim();
  const mains = f.mains?.length ? f.mains : f.main ? [f.main] : [];
  return list.filter((r) => {
    if (f.cuisine && r.cuisine !== f.cuisine) return false;
    if (f.course && r.course !== f.course) return false;
    if (f.maxTime && totalMin(r) > f.maxTime) return false;
    if (f.difficulty && r.difficulty !== f.difficulty) return false;
    if (mains.length && !mains.includes(r.main_ingredient)) return false;
    if (f.source && r.source?.type !== f.source) return false;
    if (f.veg && !r.vegetarian) return false;
    if (f.maxKcal && r.per_serving.kcal > f.maxKcal) return false;
    if (f.minP && r.per_serving.p < f.minP) return false;
    if (f.fav && !favs.has(r.id)) return false;
    if (q && !fold(`${r.title} ${r.title_local || ''} ${r.ingredients.map((i) => i.name || i.text).join(' ')}`).includes(q)) return false;
    return true;
  });
}

// "Fits my day": recipes whose serving fits into what is left of today's kcal, favouring protein. remaining: { kcal, p }
export function fitsMyDay(list, remaining, limit = 6) {
  const remK = remaining?.kcal ?? 0;
  if (!(remK >= 150)) return [];
  const remP = Math.max(remaining.p || 0, 1);
  return list
    .filter((r) => r.per_serving.kcal <= remK * 1.05 && r.per_serving.kcal >= remK * 0.2)
    .map((r) => ({ r, score: Math.min(r.per_serving.p / remP, 1) * 2 - Math.abs(1 - r.per_serving.kcal / remK) * 0.6 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.r);
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

// ---------- loading ----------
// Third-party recipes are PRIVATE: they live in the user's Supabase table as records of kind 'library' (imported by
// scripts/library/import.mjs from a GitHub Action) and reach the app through the normal sync (store.all('library')).
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
