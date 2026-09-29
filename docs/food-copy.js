// Copy-on-edit for library recipes + pure ingredient-editing helpers. No DOM. Tests: tests/food-copy.test.js.
//
// A library recipe (static JSON) becomes the user's own recipe (store kind 'recipe', the same shape the recipe book uses)
// with `from_library: <library id>`. Both kinds then share one ingredient shape, so macros, diary logging and the
// "might be wrong" checker work the same:
//   { raw, qty, unit, name, grams, food:{id,k,p,c,f,name,...}|null, conf:'user'|'high'|'medium'|'low', guess, toTaste, hint, checkOk? }
import { recipeTotals } from './food-calc.js';
import { suggestCategories } from './food-cats.js';
import { dbSnap } from './food-check.js';

const CONF = { high: 'high', medium: 'medium', low: 'low', check: 'low' };

// One library ingredient row -> own ingredient row. foodsById: { id: food } from data/foods.json.
export function libIngredientToOwn(g, foodsById = {}) {
  const food = g.food_id && foodsById[g.food_id] ? dbSnap(foodsById[g.food_id]) : null;
  const unmatchedToTaste = !food && g.grams === 0;
  return {
    raw: g.text, qty: g.qty ?? null, unit: g.unit || null, name: g.name || g.text, note: null, size: null,
    toTaste: unmatchedToTaste || (!!food && g.grams === 0 && /to taste|as required|garnish|pinch/i.test(g.text)),
    head: false, hint: g.grams != null ? g.grams : null, food, conf: food ? CONF[g.conf] || 'medium' : null,
    grams: food ? (g.grams ?? null) : (unmatchedToTaste ? 0 : null), guess: !!food && g.conf === 'check' && g.grams != null,
  };
}

export function withTotals(rec) {
  const t = recipeTotals(rec.ingredients || []);
  return { ...rec, totals: { kcal: t.kcal, p: t.p, c: t.c, f: t.f, grams: t.grams, missing: t.missing } };
}

// Library recipe -> the user's own recipe record (no id yet).
export function libToOwn(lib, foodsById = {}, now = new Date().toISOString()) {
  const ingredients = lib.ingredients.map((g) => libIngredientToOwn(g, foodsById));
  const rec = {
    title: lib.title, image: lib.image || null, servings: lib.servings,
    source: { type: 'library', url: lib.source?.url || null, name: lib.source?.name || null },
    prepMin: lib.prep_min || null, cookMin: lib.cook_min || null, ingredients, steps: [...(lib.steps || [])], notes: lib.notes || '',
    cats: suggestCategories({ title: lib.title, ingredients, steps: lib.steps || [] }), text: '', siteNutrition: null,
    main_ingredient: lib.main_ingredient ?? null, est: { ...(lib.est || {}) },
    created: now, from_library: lib.id,
  };
  return withTotals(rec);
}

export const findCopy = (recipes, libId) => (recipes || []).find((r) => r.from_library === libId) || null;
export const copiesByLib = (recipes) => new Map((recipes || []).filter((r) => r.from_library).map((r) => [r.from_library, r]));

// Immutable edits (each returns a new record with totals recomputed).
export function setIngredient(rec, i, patch) {
  if (!rec.ingredients[i]) return rec;
  const ingredients = rec.ingredients.map((g, j) => (j === i ? { ...g, ...patch } : g));
  return withTotals({ ...rec, ingredients });
}
export function removeIngredient(rec, i) {
  return withTotals({ ...rec, ingredients: rec.ingredients.filter((_, j) => j !== i) });
}
export function replaceIngredient(rec, i, ing) {
  return withTotals({ ...rec, ingredients: rec.ingredients.map((g, j) => (j === i ? ing : g)) });
}

// New amount for an ingredient. amount is in `unit` (an option from unitOptions: { key, grams }); returns the ingredient patch.
const SAFE_UNITS = new Set(['piece', 'slice', 'clove', 'tbsp', 'tsp', 'cup', 'scoop', 'can', 'pack', 'cube', 'bar', 'stalk', 'leaf']);
export function amountPatch(ing, amount, unitKey = 'g', unitGrams = 1, unitLabel = 'g') {
  const grams = Math.round(Number(amount) * unitGrams * 10) / 10;
  const useUnit = unitKey !== 'g' && SAFE_UNITS.has(unitKey);
  const qty = useUnit ? Number(amount) : grams;
  return {
    grams, hint: grams, guess: false, toTaste: false, qty, unit: useUnit ? unitKey : 'g',
    raw: `${Math.round(qty * 100) / 100} ${useUnit ? unitLabel : 'g'} ${ing.name || ''}`.trim(),
  };
}

// Edit time / servings / main ingredient (the "(est.)" facts). Returns a new record; the edited fact is no longer an estimate.
// kind: 'time' { prep, cook } | 'servings' number | 'main' id or null.
export function metaPatch(rec, kind, value) {
  const est = { ...(rec.est || {}) };
  if (kind === 'time') {
    est.time = false;
    return { ...rec, prepMin: Math.max(0, Math.round(Number(value.prep) || 0)) || null, cookMin: Math.max(0, Math.round(Number(value.cook) || 0)) || null, est };
  }
  if (kind === 'servings') { est.servings = false; return withTotals({ ...rec, servings: Math.min(48, Math.max(1, Math.round(Number(value) || 1))), est }); }
  if (kind === 'main') { est.main = false; return { ...rec, main_ingredient: value || null, est }; }
  return rec;
}
