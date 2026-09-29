// Pure helpers of the private recipe importer (scripts/library/import.mjs). No network, no filesystem. Tests: tests/library-import.test.js.
import crypto from 'node:crypto';
import { findJsonLdRecipe, normalizeJsonLd, htmlToText, extractFromHtml } from '../../supabase/functions/fetch-recipe/extract.js';
import { convertRecipe, estimateDifficulty, fToC } from './convert.mjs';
import { estimateTime } from '../../docs/food-estimate.js';
import { fold } from '../../docs/food-parse.js';

export const NAMESPACE = '6f2f5a3e-6a1a-4a55-9c2e-6d0d6a1a3b10'; // same fixed namespace as scripts/garmin_sync.py
export const LICENSE = 'personal use — see source site';
export const SOURCE_NAMES = {
  mealdb: 'TheMealDB', bbcgoodfood: 'BBC Good Food', skinnytaste: 'Skinnytaste', budgetbytes: 'Budget Bytes', pinchofyum: 'Pinch of Yum', ethan: 'Ethan Chlebowski',
};

// ---------- ids (uuid5, identical to Python's uuid.uuid5) ----------
export function uuid5(namespace, name) {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const h = crypto.createHash('sha1').update(ns).update(Buffer.from(name, 'utf8')).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
export const recordId = (userId, source, sourceId) => uuid5(NAMESPACE, `${userId}:library:${source}:${sourceId}`);
// Stable id of a page: its path without slashes/query (the site is already in `source`).
export const sourceIdOf = (url) => new URL(url).pathname.replace(/^\/+|\/+$/g, '').toLowerCase();

// ---------- seafood / fish filter (exclude: ['seafood'] and optionally 'fish') ----------
const SEAFOOD = /\b(shrimps?|prawns?|mussels?|clams?|oysters?|scallops?|crabs?|crabmeat|lobsters?|squids?|calamari|octopus|octopuses|crayfish|crawfish|langoustines?|cockles?|whelks?|shellfish|seafood|surimi|abalone)\b/;
const FISH = /\b(fish|salmon|tuna|cod|haddock|trout|mackerel|sardines?|anchov(y|ies)|tilapia|halibut|sea bass|herring|pollock|plaice|snapper|mahi|swordfish|kippers?|pilchards?|monkfish|hake|catfish)\b/;
// Sauces made from these are not what the user avoids: strip them before testing.
const HARMLESS = /\b(oyster|fish|shrimp|crab) (sauce|flavou?red)\b|\bshrimp paste\b/g;
const strip = (text) => fold(text).replace(HARMLESS, ' ');
export const isSeafood = (text) => SEAFOOD.test(strip(text));
export const isFish = (text) => FISH.test(strip(text));
// raw: { title, ingredients: [line], category? (MealDB) }. Returns the reason ('seafood' | 'fish') or null.
export function excluded(raw, exclude = ['seafood']) {
  const text = `${raw.title || ''} | ${(raw.ingredients || []).join(' | ')}`;
  if (exclude.includes('seafood') && (raw.category === 'Seafood' || isSeafood(text))) return 'seafood';
  if (exclude.includes('fish') && (raw.category === 'Seafood' || isSeafood(text) || isFish(text))) return 'fish';
  return null;
}

// ---------- published vs computed nutrition ----------
const r1 = (x) => Math.round(x * 10) / 10;
// published: { kcal, protein, carbs, fat } per serving (from JSON-LD) or null. Returns them only when complete and plausible.
export function usablePublished(published) {
  if (!published) return null;
  const { kcal, protein, carbs, fat } = published;
  if (![kcal, protein, carbs, fat].every((v) => Number.isFinite(v) && v >= 0)) return null;
  if (kcal < 30 || kcal > 2500) return null;
  return { kcal: Math.round(kcal), p: r1(protein), c: r1(carbs), f: r1(fat) };
}
// Prefer what the site publishes; keep our computed numbers (from the ingredient breakdown) next to it.
export function chooseNutrition(rec, published) {
  const pub = usablePublished(published);
  if (!pub) return { ...rec, nutrition_basis: 'computed' };
  return { ...rec, per_serving: pub, computed_per_serving: rec.per_serving, source_nutrition: pub, nutrition_basis: 'published' };
}

// ---------- schema.org Recipe page -> raw recipe (input of convertRecipe) ----------
const asUrl = (u) => (typeof u === 'string' && /^https?:\/\//.test(u) ? u : null);
function videoOf(ld) {
  const v = Array.isArray(ld.video) ? ld.video[0] : ld.video;
  if (!v) return null;
  return asUrl(typeof v === 'string' ? v : v.embedUrl || v.contentUrl || v.url);
}
export function courseOf(text) {
  const t = fold(text);
  if (/\b(dessert|cake|cookies?|brownies?|pudding|ice cream|pie)\b/.test(t)) return /\b(bread|muffins?|scones?|cookies?|cake|pie)\b/.test(t) ? 'baking' : 'dessert';
  if (/\b(soups?|stew|chowder)\b/.test(t)) return 'soup';
  if (/\b(breakfast|brunch|pancakes?|oatmeal|granola)\b/.test(t)) return 'breakfast';
  if (/\b(side dish|sides?|salad)\b/.test(t) && !/\b(main|dinner)\b/.test(t)) return 'side';
  if (/\b(starters?|appetizers?)\b/.test(t)) return 'starter';
  if (/\b(snacks?|dips?)\b/.test(t)) return 'snack';
  return 'main';
}
const KNOWN_CUISINES = new Set(['italian', 'french', 'polish', 'american', 'british', 'mexican', 'indian', 'chinese', 'japanese', 'thai', 'greek', 'spanish', 'korean', 'mediterranean', 'middle eastern']);
export function cuisineOfSite(s) {
  const first = fold(String(s || '').split(/[,/]/)[0]).trim();
  return KNOWN_CUISINES.has(first) ? first : 'international';
}

// Returns null when the page has no usable schema.org Recipe.
export function jsonLdToRaw(html, url, source) {
  const ld = findJsonLdRecipe(html);
  if (!ld) return null;
  const n = normalizeJsonLd(ld);
  if (!n.title || !n.ingredients.length || !n.steps.length) return null;
  const steps = n.steps.map(fToC);
  let prep = n.prepMin, cook = n.cookMin, time_est = false;
  if (prep == null && cook == null && n.totalMin != null) { prep = Math.min(20, Math.round(n.totalMin * 0.3)); cook = n.totalMin - prep; }
  if (prep == null && cook == null) { ({ prep_min: prep, cook_min: cook } = estimateTime(steps, { nIngredients: n.ingredients.length, title: n.title })); time_est = true; }
  prep = prep ?? 0; cook = cook ?? 0;
  return {
    id: null, title: n.title, cuisine: cuisineOfSite(n.cuisine), course: courseOf(`${n.category || ''} ${n.title}`),
    ...(n.servings ? { servings: n.servings } : {}), prep_min: prep, cook_min: cook, ...(time_est ? { time_est: true } : {}),
    difficulty: estimateDifficulty(n.ingredients.length, steps.length, prep + cook),
    ingredients: n.ingredients, steps, image: n.image || null, video: videoOf(ld),
    source: { type: source, name: SOURCE_NAMES[source] || source, url, ...(n.author ? { author: n.author } : {}), license: LICENSE },
    published: n.nutrition,
  };
}

// raw (+ published nutrition) -> library recipe. When the site gives no serving count, serving size follows the published kcal.
export function buildRecipe(raw, ctx) {
  const { published, ...base } = raw;
  const pub = usablePublished(published);
  let rec = convertRecipe(base, ctx);
  if (!(base.servings > 0) && pub) {
    const total = rec.per_serving.kcal * rec.servings;
    const s = Math.min(24, Math.max(1, Math.round(total / pub.kcal)));
    if (s !== rec.servings) rec = convertRecipe({ ...base, servings: s, servings_est: true }, ctx);
  }
  return chooseNutrition(rec, published);
}

// Fallback for blogs without schema.org Recipe data (Ethan Chlebowski, Squarespace): the page text has an "Ingredients" heading
// followed by lines, then an "Instructions" heading. Sub-headings ending in ':' are dropped; other sub-headings become unmatched rows (flagged 'check').
export function textToRaw(html, url, source) {
  const lines = htmlToText(html).split(/\n/).map((l) => l.replace(/^•\s*/, '').trim()).filter((l) => l && l !== '•');
  const a = lines.findIndex((l) => /^ingredients:?$/i.test(l));
  const b = lines.findIndex((l, i) => i > a && /^(instructions|method|directions):?$/i.test(l));
  if (a < 0 || b < 0) return null;
  const ingredients = lines.slice(a + 1, b).filter((l) => !/:$/.test(l) && l.length < 140);
  let end = lines.findIndex((l, i) => i > b && /^(notes?|nutrition|related|more recipes|share|comments?)\b/i.test(l));
  if (end < 0) end = lines.length;
  const steps = lines.slice(b + 1, end).filter((l) => l.length > 25).map(fToC);
  if (ingredients.length < 3 || steps.length < 2) return null;
  const meta = extractFromHtml(html, url);
  const title = String(meta.title || '').replace(/\s+[|—–-]\s+.*$/, '').trim();
  if (!title) return null;
  const { prep_min, cook_min } = estimateTime(steps, { nIngredients: ingredients.length, title });
  return {
    id: null, title, cuisine: 'international', course: courseOf(title), prep_min, cook_min, time_est: true,
    difficulty: estimateDifficulty(ingredients.length, steps.length, prep_min + cook_min), ingredients, steps,
    image: meta.image ? meta.image.replace(/^http:/, 'https:') : null, video: null,
    source: { type: source, name: SOURCE_NAMES[source] || source, url, author: 'Ethan Chlebowski', license: LICENSE }, published: null,
  };
}
