// Pure helpers for copying / moving / deleting food-diary entries. No DOM, no store. Tests: tests/diary-copy.test.js.
// A diary entry is a store record of kind 'meal': { id, day, meal, t, label, source, grams|servings, kcal, p, c, f, ... }.

export const MEAL_KEYS = ['breakfast', 'lunch', 'dinner', 'snack'];
const sortKey = (e) => e.t || '';

// New entries (no id, so the store gives each a fresh one) with the same amounts and macros, put on `day` and,
// when `meal` is given, in that meal (otherwise each entry stays in its own meal). Original order is kept.
export function copiedEntries(entries, { day, meal = null, now = new Date() }) {
  const base = now.getTime();
  return [...entries].sort((a, b) => sortKey(a).localeCompare(sortKey(b))).map(({ id, ...e }, i) => ({
    ...e,
    day,
    meal: meal || e.meal,
    t: new Date(base + i).toISOString(),
  }));
}

// The same entry in another meal (same id, so it is a move, not a copy). Returns null when nothing would change.
export function movedEntry(entry, meal) {
  if (!entry || !MEAL_KEYS.includes(meal) || entry.meal === meal) return null;
  return { ...entry, meal };
}

// Day picker shortcuts around `today` (both 'YYYY-MM-DD'); addDays(day, n) is passed in so this stays dependency-free.
export function dayChoices(today, addDays) {
  return [
    { day: addDays(today, -1), label: 'Yesterday' },
    { day: today, label: 'Today' },
    { day: addDays(today, 1), label: 'Tomorrow' },
  ];
}

// Validated copy target from the picker: { day, meal } or null when the day is not a YYYY-MM-DD date or the meal is unknown.
// The target may equal the source (lunch -> dinner on the same day, or even the same meal again).
export function copyTarget(day, meal) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '') || !MEAL_KEYS.includes(meal)) return null;
  return { day, meal };
}

// Short toast text, e.g. "Copied 3 items to Lunch · Tomorrow".
export function copyMessage(count, { mealName = null, dayName = '' } = {}) {
  const items = `${count} item${count === 1 ? '' : 's'}`;
  return `Copied ${items}${mealName ? ` to ${mealName}` : ''}${dayName ? ` · ${dayName}` : ''}`;
}

// Toast text after deleting a whole meal, e.g. "Deleted lunch · 3 items".
export function deleteMessage(count, mealName = '') {
  const items = `${count} item${count === 1 ? '' : 's'}`;
  return mealName ? `Deleted ${mealName.toLowerCase()} · ${items}` : `Deleted ${items}`;
}

// ---------- a diary meal saved as a recipe ----------
const r1 = (x) => Math.round(x * 10) / 10;
const ing = (o) => ({ raw: o.raw, qty: o.qty ?? null, unit: o.unit || null, name: o.name, note: null, size: null, toTaste: false, head: false,
  hint: o.grams ?? null, food: o.food, conf: 'user', grams: o.grams ?? null, guess: false });
// A food made from an entry's own macros (for entries with no food behind them): per 100 g of `grams`.
const entryFood = (e, grams) => ({ src: 'custom', id: null, name: e.label || 'Item', k: r1((e.kcal || 0) * 100 / grams), p: r1((e.p || 0) * 100 / grams), c: r1((e.c || 0) * 100 / grams), f: r1((e.f || 0) * 100 / grams) });

// Ingredient rows (own-recipe shape, see food-copy.js) for one diary entry. lookup(id) -> own recipe | undefined.
// Foods keep their weight; an own recipe expands into its ingredients scaled to the amount eaten; anything else
// (library recipe, deleted recipe, quick calories) becomes one row carrying the entry's macros.
export function entryIngredients(e, lookup = () => undefined) {
  const type = e.source?.type;
  if (e.food && Number(e.grams) > 0) {
    const grams = Number(e.grams);
    const byUnit = e.unit && e.unit !== 'g' && Number(e.qty) > 0;
    return [ing({ raw: `${byUnit ? `${e.qty} ${e.unit}` : `${r1(grams)} g`} ${e.label}`, qty: byUnit ? Number(e.qty) : grams, unit: byUnit ? e.unit : 'g', name: e.label, grams, food: e.food })];
  }
  const rec = type === 'recipe' ? lookup(e.source.id) : null;
  if (rec?.ingredients?.length) {
    const k = Number(e.scale) > 0 ? Number(e.scale) : 1;
    const per = Number(e.per?.grams);
    const eaten = Number(e.servings) > 0 ? Number(e.servings) * k : Number(e.grams) > 0 && per > 0 ? (Number(e.grams) / per) * k : null;
    if (eaten) {
      const f = eaten / Math.max(1, Number(rec.servings) || 1);
      return rec.ingredients.filter((g) => !g.head).map((g) => ({
        ...g, grams: g.grams == null || g.grams === '' ? g.grams : r1(Number(g.grams) * f), hint: g.hint == null ? g.hint : r1(Number(g.hint) * f),
        qty: g.qty == null ? g.qty : r1(Number(g.qty) * f),
      }));
    }
  }
  if (!(e.kcal > 0)) return [];
  const grams = Number(e.grams) > 0 ? Number(e.grams) : 100;
  return [ing({ raw: Number(e.grams) > 0 ? `${r1(grams)} g ${e.label}` : `${e.label} (${Math.round(e.kcal)} kcal)`, qty: grams, unit: 'g', name: e.label || 'Item', grams, food: entryFood(e, grams) })];
}

// New-recipe draft (food-recipes.js editRecipe) from every entry of one meal, in the order they were logged. One serving.
export function mealRecipeDraft(entries, { title = '', lookup } = {}) {
  const ingredients = [...entries].sort((a, b) => sortKey(a).localeCompare(sortKey(b))).flatMap((e) => entryIngredients(e, lookup));
  return { title, servings: 1, image: null, source: { type: 'manual' }, ingredients, steps: [], notes: '', links: [] };
}
