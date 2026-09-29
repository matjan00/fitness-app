// Converts "raw" recipes (ingredient lines as text) from any source into the library format
// (see docs/food-library.js). Uses the app's own modules so numbers match what the app computes elsewhere.
// Pure functions except loadIndex().
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIngredient, fold } from '../../docs/food-parse.js';
import { buildIndex, bestMatch, toGrams } from '../../docs/food-db.js';
import { macrosFor } from '../../docs/food-calc.js';
import { CATEGORIES } from '../../docs/food-cats.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DOCS = path.join(here, '..', '..', 'docs');

export function loadIndex() {
  const j = JSON.parse(fs.readFileSync(path.join(DOCS, 'data', 'foods.json'), 'utf8'));
  const foods = j.foods.map((f) => ({ ...f, src: 'db' }));
  return { index: buildIndex(foods), byId: new Map(foods.map((f) => [f.id, f])) };
}

const r1 = (x) => Math.round(x * 10) / 10;

// One ingredient line -> { row, macros }. row follows the library format.
const SEASONING = new RegExp('^(salt|sea salt|pepper|black pepper|white pepper|paprika|saffron|bay|rosemary|thyme|parsley|dill|cloves?|allspice|oregano|basil|sage|nutmeg|cinnamon|icing sugar|water|ice)( |$)', 'i');
export function convertIngredient(line, index) {
  const p = parseIngredient(line);
  const text = String(line).trim();
  if (p.head) return { row: { text, qty: null, unit: null, name: p.name, grams: 0, food_id: null, conf: 'high' }, macros: null, head: true };
  p.name = (p.name || '').replace(/^(as required|to taste|sprink\w*|garnish|pinch of|for garnish)\s+/i, '').replace(/^pecorino( romano)?$/i, 'parmesan (pecorino)');
  const m = p.name ? bestMatch(index, p.name) : null;
  const food = m?.food || null;
  const g = toGrams({ qty: p.qty, unit: p.unit, size: p.size, grams: p.grams, toTaste: p.toTaste }, food);
  let conf = m ? m.conf : 'check';
  // Seasonings and garnishes with no usable amount ("as required", "pinch", "salt") count as nothing, on purpose.
  const seasoning = SEASONING.test(p.name || '');
  const negligible = !food && seasoning && !(p.qty != null && p.unit === 'g' && p.qty > 5);
  let grams = g.grams;
  if (food && grams == null && seasoning) { grams = 0; conf = 'medium'; }
  if (negligible) { grams = 0; conf = 'medium'; }
  if ((grams == null || !food) && !negligible) conf = 'check';
  if (g.guess && conf === 'high') conf = 'medium';
  return {
    row: { text, qty: p.qty ?? null, unit: p.unit ?? null, name: p.name || text, grams: food || negligible ? grams : null, food_id: food?.id ?? null, conf },
    macros: food && grams ? macrosFor(food, grams) : null,
  };
}

const MEAT = /\b(chicken|turkey|beef|steak|pork|bacon|ham|prosciutto|pancetta|sausage|chorizo|lamb|mutton|veal|duck|goose|rabbit|venison|anchov\w*|fish|salmon|tuna|cod|haddock|prawn\w*|shrimp|crab|mussel\w*|squid|sardine\w*|pilchard\w*|herring|lard|suet|gelatin\w*|bone|oxtail|kielbasa|mince[d]? meat|ground beef|ground pork)\b/;
const STOCK_MEAT = /\b(chicken|beef|pork|meat|fish) (stock|broth|bouillon|cube)\b/;

export function convertRecipe(raw, ctx) {
  const rows = [];
  let tot = { kcal: 0, p: 0, c: 0, f: 0 };
  for (const line of raw.ingredients) {
    const c = convertIngredient(line, ctx.index);
    if (c.head) continue;
    rows.push(c.row);
    if (c.macros) tot = { kcal: tot.kcal + c.macros.kcal, p: tot.p + c.macros.p, c: tot.c + c.macros.c, f: tot.f + c.macros.f };
  }
  const servings = Math.max(1, raw.servings || 1);
  const ingText = fold(rows.map((r) => `${r.name} ${r.food_id || ''}`).join(' | '));
  const title = fold(raw.title);
  const vegetarian = typeof raw.vegetarian === 'boolean' ? raw.vegetarian : !(MEAT.test(ingText) || MEAT.test(title) || STOCK_MEAT.test(ingText));
  let main = raw.main_ingredient;
  if (main === undefined) {
    const keys = CATEGORIES.main.items.filter((it) => it.re.test(title) || it.re.test(ingText)).map((it) => it.key);
    const pri = ['chicken', 'turkey', 'beef', 'pork', 'seafood', 'fish', 'pasta', 'rice', 'potatoes', 'groats', 'legumes', 'twarog', 'eggs', 'veggies', 'oats', 'vege'];
    main = pri.find((k) => keys.includes(k)) || keys[0] || null;
  }
  const out = {
    id: raw.id, title: raw.title, ...(raw.title_local ? { title_local: raw.title_local } : {}),
    cuisine: raw.cuisine, course: raw.course, servings, prep_min: raw.prep_min, cook_min: raw.cook_min,
    ...(raw.time_est ? { time_est: true } : {}),
    difficulty: raw.difficulty, vegetarian, main_ingredient: main,
    ingredients: rows, steps: raw.steps,
    per_serving: { kcal: Math.round(tot.kcal / servings), p: r1(tot.p / servings), c: r1(tot.c / servings), f: r1(tot.f / servings) },
    checks: rows.filter((r) => r.conf === 'check').length,
    image: raw.image ?? null, video: raw.video ?? null, source: raw.source,
    ...(raw.source_nutrition ? { source_nutrition: raw.source_nutrition } : {}),
    ...(raw.notes ? { notes: raw.notes } : {}),
  };
  return out;
}

// ---------- TheMealDB ----------
const AREA_CUISINE = { italian: 'italian', french: 'french', france: 'french', polish: 'polish' };
const F2C = (f) => Math.round(((f - 32) * 5 / 9) / 5) * 5;

export function fToC(text) {
  return text
    .replace(/(\d{3})\s?(?:°|º|degrees)?\s?(?:F|Fahrenheit)\b/g, (_, n) => `${F2C(Number(n))}°C`)
    .replace(/(\d{2,3})\s?(?:°|º)\s?C\b/g, '$1°C');
}

export function splitSteps(instr) {
  let parts = String(instr || '').split(/\r?\n+/).map((s) => s.trim()).filter(Boolean)
    .filter((s) => !/^(step\s*\d+|\d+\.?)$/i.test(s)).map((s) => s.replace(/^(step\s*\d+[:.\-\s]*|\d+[.)]\s+)/i, ''));
  if (parts.length <= 1 && parts[0]) {
    const sentences = parts[0].match(/[^.!?]+[.!?]+(\s|$)/g) || [parts[0]];
    parts = [];
    for (let i = 0; i < sentences.length; i += 2) parts.push(sentences.slice(i, i + 2).join('').trim());
  }
  return parts.map(fToC).filter(Boolean);
}

export function estimateTimes(steps) {
  let mins = 0;
  for (const s of steps) {
    for (const m of s.matchAll(/(\d+)(?:\s?(?:-|to)\s?(\d+))?\s*(hours?|hrs?|minutes?|mins?)\b/gi)) {
      const n = Number(m[2] || m[1]);
      mins += /^h/i.test(m[3]) ? n * 60 : n;
    }
  }
  const cook = Math.min(Math.max(mins, 10), 240);
  return { prep_min: 15, cook_min: cook };
}

export function estimateDifficulty(nIngredients, nSteps, totalMin) {
  const score = nIngredients / 6 + nSteps / 5 + totalMin / 90;
  return score < 2.4 ? 'easy' : score < 4.2 ? 'medium' : 'hard';
}

export function mealCourse(meal) {
  const t = fold(meal.strMeal);
  const cat = meal.strCategory;
  if (/\b(soup|rosol|ribollita|bortsch|borscht|barszcz|bisque|pistou|chowder)\b/.test(t)) return 'soup';
  if (cat === 'Dessert') return /\b(cake|bread|piernik|gingerbread|biscuit|cookie|croissant|pastr|bundt|tart|doughnut|paczk)/.test(t) ? 'baking' : 'dessert';
  if (cat === 'Starter') return 'starter';
  if (cat === 'Side') return 'side';
  if (cat === 'Breakfast') return 'breakfast';
  return 'main';
}

export function mealdbToRaw(meal, ov = {}) {
  const lines = [];
  for (let i = 1; i <= 20; i++) {
    const ing = (meal[`strIngredient${i}`] || '').trim();
    const mea = (meal[`strMeasure${i}`] || '').trim();
    if (ing) { const l = `${mea} ${ing}`.trim(); lines.push(ov.lines?.[l] || l); }
  }
  const steps = splitSteps(meal.strInstructions);
  const t = estimateTimes(steps);
  const course = mealCourse(meal);
  const servings = ov.servings || (course === 'baking' ? 12 : 4);
  return {
    id: `mealdb-${meal.idMeal}`, title: meal.strMeal.replace(/\s*\(.*\)\s*$/, '').trim(),
    ...(/\(.*\)/.test(meal.strMeal) ? { title_local: meal.strMeal.match(/\((.*)\)/)[1] } : {}),
    cuisine: AREA_CUISINE[fold(meal.strArea)] || 'international', course, servings, ...t, time_est: true,
    difficulty: estimateDifficulty(lines.length, steps.length, t.prep_min + t.cook_min),
    ingredients: lines, steps,
    image: meal.strMealThumb || null, video: meal.strYoutube || null,
    source: { type: 'themealdb', name: 'TheMealDB', url: `https://www.themealdb.com/meal/${meal.idMeal}`, license: 'TheMealDB free API (test key). Recipe text and photos are user-contributed; personal use. TheMealDB gives no serving count: servings are assumed (4, or 12 for cakes/bread).' },
    ...(meal.strSource ? { notes: `Original recipe: ${meal.strSource}` } : {}),
  };
}
