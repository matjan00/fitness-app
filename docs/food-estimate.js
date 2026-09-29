// Estimators for recipe facts a source does not state (main ingredient, time, servings) + one "view" shape so
// library recipes, their personal copies and own recipes can be filtered/sorted together. Pure, no DOM.
// Tests: tests/food-estimate.test.js.   Estimated fields are flagged in `est: { main, time, servings }` (true = guessed).
import { CATEGORIES } from './food-cats.js';
import { fold } from './food-parse.js';

const PROTEIN_KEYS = ['chicken', 'turkey', 'beef', 'pork', 'seafood', 'fish', 'eggs', 'twarog', 'vege', 'legumes'];
const BASE_KEYS = ['pasta', 'rice', 'potatoes', 'groats', 'oats'];
const CAT_ORDER = ['chicken', 'turkey', 'beef', 'pork', 'seafood', 'fish', 'eggs', 'twarog', 'vege', 'legumes', 'pasta', 'rice', 'potatoes', 'groats', 'oats', 'veggies'];
const catItems = CAT_ORDER.map((k) => CATEGORIES.main.items.find((i) => i.key === k)).filter(Boolean);
const MEATRE = /\b(chicken|turkey|beef|steak|pork|bacon|ham|prosciutto|pancetta|sausage|chorizo|lamb|veal|duck|fish|salmon|tuna|cod|prawn\w*|shrimp|kurczak\w*|wieprzow\w*|wolow\w*|schab\w*|kielbas\w*|ryb\w*|losos\w*)\b/;

// First main-ingredient category an ingredient name belongs to (by CAT_ORDER), or null.
const catOf = (text) => catItems.find((it) => it.re.test(text))?.key || null;

// ingredients: library rows ({name, grams, food_id}) or own rows ({name, grams, food:{p}}); foodsById optional for p lookups.
// Rule: the protein source (chicken, beef, fish, eggs, ...) with the most protein grams wins when it gives >= 15 g protein
// per recipe (title match counts extra); otherwise the heaviest starch (pasta, rice, ...); otherwise vegetables; otherwise null.
export function estimateMain({ title = '', ingredients = [], course = 'main' }, foodsById = {}) {
  const t = fold(title);
  const score = {};
  for (const ing of ingredients) {
    if (ing.head || !(ing.grams > 0) || STOCK.test(fold(ing.name || ''))) continue;
    const key = catOf(fold(`${ing.name || ''} ${ing.food_id || ''}`));
    if (!key || (key === 'eggs' && (course === 'baking' || course === 'dessert') && !/egg|jaj/.test(t))) continue;
    const p100 = ing.food?.p ?? foodsById[ing.food_id]?.p ?? 0;
    const val = PROTEIN_KEYS.includes(key) ? (ing.grams * p100) / 100 : ing.grams;
    score[key] = (score[key] || 0) + val;
  }
  for (const key of PROTEIN_KEYS) if (catOf(t) === key || catItems.find((i) => i.key === key)?.re.test(t)) score[key] = (score[key] || 0) + 30;
  const prot = PROTEIN_KEYS.filter((k) => score[k] > 0).sort((a, b) => score[b] - score[a]);
  if (prot.length && score[prot[0]] >= 15) return prot[0];
  const base = BASE_KEYS.filter((k) => score[k] > 0).sort((a, b) => score[b] - score[a]);
  if (base.length) return base[0];
  const veg = ingredients.reduce((a, i) => a + (i.grams > 0 && VEG.test(fold(i.name || '')) ? i.grams : 0), 0);
  if (score.veggies > 0 || veg >= 200) return 'veggies';
  return prot[0] || null;
}

const VEG = /(onion|tomato|carrot|cabbage|leek|pepper|aubergine|eggplant|mushroom|celery|courgette|spinach|kale)/;
const STOCK = /(^| )(stock|broth|bouillon|consomme|cube)( |$)/;
const SKIP_TIME = /marinat|refrigerat|chill|overnight|soak|prove|proof|rest\b|cool completely|freez/i;
// Minutes stated in the steps ("simmer 20 minutes", "1-2 hours") plus a per-method default. Returns { prep_min, cook_min }.
export function estimateTime(steps = [], { nIngredients = 8, title = '' } = {}) {
  let mins = 0;
  for (const s of steps.flatMap((x) => String(x).split(/(?<=[.!?])\s+/))) {
    if (SKIP_TIME.test(s)) continue;
    for (const m of String(s).matchAll(/(\d+)(?:\s?(?:-|to)\s?(\d+))?\s*(hours?|hrs?|minutes?|mins?)\b/gi)) {
      const n = Number(m[2] || m[1]);
      mins += /^h/i.test(m[3]) ? n * 60 : n;
    }
  }
  const text = fold(`${title} ${steps.join(' ')}`);
  let cook = mins;
  if (!cook) cook = /\b(no.cook|salad|smoothie|sandwich|overnight oats)\b/.test(text) ? 0 : /\b(stew|braise|roast|slow cook|casserole)\b/.test(text) ? 60 : /\b(bake|oven)\b/.test(text) ? 35 : /\b(simmer|boil)\b/.test(text) ? 25 : 15;
  cook = Math.min(Math.max(Math.round(cook / 5) * 5, cook ? 5 : 0), 300);
  const prep = Math.min(30, Math.max(10, Math.round((5 + nIngredients * 1.5) / 5) * 5));
  return { prep_min: prep, cook_min: cook };
}

const KCAL_PER_SERVING = { main: 600, breakfast: 450, soup: 350, starter: 250, side: 250, dessert: 300, baking: 250, snack: 200 };
// Servings from the recipe's total kcal so a serving is a realistic portion (~600 kcal for a main).
export function estimateServings(totalKcal, course = 'main') {
  const target = KCAL_PER_SERVING[course] || 500;
  const max = course === 'baking' ? 24 : 12;
  return Math.min(max, Math.max(1, Math.round((totalKcal || 0) / target)));
}

export const isVegetarianNames = (names) => !MEATRE.test(fold(names.join(' | ')));

// ---------- one shape for lists ----------
export const totalOf = (r) => (r.prep_min || 0) + (r.cook_min || 0);
const MEAL_COURSE = { breakfast: 'breakfast', lunch: 'main', dinner: 'main', snack: 'snack', dessert: 'dessert' };

// A library recipe with the user's personal copy (if any) laid over it: the copy's amounts, servings, times and main ingredient win.
export function effectiveLib(r, copy, recipePer) {
  if (!copy) return { ...r, est: r.est || {} };
  return {
    ...r, servings: copy.servings, prep_min: copy.prepMin ?? r.prep_min, cook_min: copy.cookMin ?? r.cook_min,
    main_ingredient: copy.main_ingredient !== undefined ? copy.main_ingredient : r.main_ingredient,
    per_serving: recipePer(copy), est: copy.est || {}, copy: true,
  };
}

// An own recipe (store kind 'recipe', not a copy) in library shape. Missing time/main are estimated on the fly.
export function ownView(rec, recipePer, foodsById = {}) {
  const ings = (rec.ingredients || []).filter((i) => !i.head);
  const est = { ...(rec.est || {}) };
  let prep = rec.prepMin, cook = rec.cookMin;
  if (!prep && !cook) { const t = estimateTime(rec.steps || [], { nIngredients: ings.length, title: rec.title }); prep = t.prep_min; cook = t.cook_min; est.time = true; }
  let main = rec.main_ingredient;
  if (main === undefined) {
    main = rec.cats?.main?.[0] || estimateMain({ title: rec.title, ingredients: ings }, foodsById);
    est.main = est.main ?? !rec.cats?.main?.length;
  }
  return {
    id: `own-${rec.id}`, rid: rec.id, own: true, title: rec.title, image: rec.image || null, cuisine: null,
    course: MEAL_COURSE[rec.cats?.meal?.[0]] || 'main', servings: rec.servings || 1, prep_min: prep || 0, cook_min: cook || 0, difficulty: null,
    vegetarian: isVegetarianNames(ings.map((i) => `${i.name || ''} ${i.food?.id || ''}`)), main_ingredient: main || null, ingredients: ings,
    per_serving: recipePer(rec), source: { type: 'own', name: 'My recipes' }, est,
  };
}

// ---------- sorting ----------
export const SORTS = [['default', 'Default'], ['pp100', 'Protein per 100 kcal'], ['kcal', 'Calories (low first)'], ['time', 'Time (quick first)'], ['name', 'Name A-Z']];
const pp100 = (r) => (r.per_serving.kcal > 0 ? r.per_serving.p / r.per_serving.kcal : 0);
export function sortRecipes(list, key) {
  const c = { pp100: (a, b) => pp100(b) - pp100(a), kcal: (a, b) => a.per_serving.kcal - b.per_serving.kcal, time: (a, b) => totalOf(a) - totalOf(b), name: (a, b) => a.title.localeCompare(b.title) }[key];
  return c ? [...list].sort(c) : list;
}
