// Food table search, ingredient → food matching and quantity → grams conversion.
// Pure logic (no DOM). The bundled table (data/foods.json) is lazy-loaded with loadFoods().
//
//   buildIndex(foods)               → index used by search / bestMatch
//   search(index, query, limit)     → [{ food, score }]
//   bestMatch(index, name)          → { food, score, conf: 'high'|'medium'|'low' } | null
//   matchKey(name)                  → stable key for remembering a user's choice (kind 'foodmatch')
//   toGrams(ing, food)              → { grams, guess, how } (grams null when unknown)
//   unitOptions(food)               → [{ key, label, grams }] portion units a food supports

import { fold, UNIT_LABEL } from './food-parse.js';

// ---------- loading ----------
let foodsPromise = null;
let foodsCache = null;
export function loadFoods(url = 'data/foods.json') {
  if (foodsCache) return Promise.resolve(foodsCache);
  if (!foodsPromise) {
    foodsPromise = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`Could not load the food table (${r.status})`);
      return r.json();
    }).then((j) => {
      foodsCache = j.foods.map((f) => ({ ...f, src: 'db' }));
      return foodsCache;
    }).catch((e) => { foodsPromise = null; throw e; });
  }
  return foodsPromise;
}
export const foodsLoaded = () => foodsCache;

// ---------- tokens ----------
const STOP = new Set(['z', 'ze', 'w', 'we', 'na', 'do', 'i', 'oraz', 'lub', 'albo', 'od', 'bez', 'o', 'po', 'dla', 'np', 'itp',
  'of', 'the', 'and', 'or', 'with', 'in', 'for', 'a', 'an', 'to', 'into', 'on', 'plus',
  'swiezy', 'swieza', 'swieze', 'swiezej', 'swiezego', 'swiezych', 'fresh', 'dobrej', 'jakosci', 'ulubiony', 'ulubionej', 'ulubione',
  'drobno', 'grubo', 'posiekany', 'posiekana', 'posiekane', 'posiekanej', 'posiekanego', 'pokrojony', 'pokrojona', 'pokrojone',
  'pokrojonej', 'pokrojonego', 'starty', 'starta', 'starte', 'startej', 'przecisniety', 'przecisniete', 'obrany', 'obrana', 'obrane',
  'chopped', 'diced', 'minced', 'sliced', 'grated', 'peeled', 'finely', 'roughly', 'large', 'small', 'medium', 'big',
  'duzy', 'duza', 'duze', 'duzej', 'maly', 'mala', 'male', 'sredni', 'srednia', 'srednie', 'ok', 'about', 'optional', 'opcjonalnie',
  'dowolny', 'dowolna', 'dowolne', 'jakis', 'jakies', 'troche', 'some', 'extra', 'organic', 'bio', 'eko', 'dojrzaly', 'dojrzale', 'ripe',
  'kawalek', 'kawalki', 'kawalkow', 'piece', 'pieces']);

export function tokens(s) {
  const f = fold(s).replace(/(\d),(\d)/g, '$1.$2');
  return f.split(/[^a-z0-9.]+/).map((t) => t.replace(/^\.+|\.+$/g, '')).filter((t) => t && !STOP.has(t));
}
// Lower-cased tokens that keep diacritics (to break ties like "mąki" → mąka, not "mak").
function rawTokens(s) {
  return String(s ?? '').toLowerCase().replace(/(\d),(\d)/g, '$1.$2').split(/[^\p{L}0-9.]+/u)
    .map((t) => t.replace(/^\.+|\.+$/g, '')).filter((t) => t && !STOP.has(fold(t)));
}

// Similarity of two single words: 1 exact, ~0.9 same stem (Polish/English inflection), 0 otherwise.
function wordSim(a, b, ra, rb) {
  if (a === b) return ra && rb && ra !== rb && (/[^a-z0-9.]/.test(ra) || /[^a-z0-9.]/.test(rb)) ? 0.97 : 1;
  if (/^\d/.test(a) || /^\d/.test(b)) return 0;
  const n = Math.min(a.length, b.length);
  let p = 0;
  while (p < n && a[p] === b[p]) p++;
  const short = n, long = Math.max(a.length, b.length);
  if (p < 3 || p < short - 2 || long - p > 3) return 0;
  let s = 0.96 - 0.01 * ((a.length - p) + (b.length - p));
  // diacritics disagree inside the shared stem → weaker ("maki" vs "mak" when the text said "mąki")
  if (ra && rb && ra.slice(0, p) !== rb.slice(0, p)) s -= 0.06;
  return s;
}

export function buildIndex(foods) {
  return foods.map((food) => {
    const names = [food.pl, food.en, food.name, ...(food.a || [])].filter(Boolean);
    // Own / branded foods have long names ("Twaróg półtłusty Piątnica"): also index their first words.
    if (food.src && food.src !== 'db' && food.name) {
      const w = String(food.name).split(/\s+/);
      for (let i = 1; i < Math.min(w.length, 4); i++) names.push(w.slice(0, i).join(' '));
    }
    const seen = new Set();
    const aliases = [];
    for (const n of names) {
      const t = tokens(n);
      const key = t.join(' ');
      if (!t.length || seen.has(key)) continue;
      seen.add(key);
      aliases.push({ t, r: rawTokens(n), full: key });
    }
    return { food, aliases };
  });
}

function scoreAlias(q, qr, alias, linked = false) {
  // best matching query token for every alias token
  let aSum = 0;
  const usedQ = new Set();
  for (let i = 0; i < alias.t.length; i++) {
    let best = 0, bj = -1;
    for (let j = 0; j < q.length; j++) {
      if (usedQ.has(j)) continue;
      const s = wordSim(alias.t[i], q[j], alias.r[i], qr[j]);
      if (s > best) { best = s; bj = j; }
    }
    if (bj >= 0) usedQ.add(bj);
    aSum += best;
  }
  const aliasCov = aSum / alias.t.length;
  const queryCov = usedQ.size / q.length;
  let score = aliasCov * (0.62 + 0.38 * queryCov);
  // The head noun comes first in Polish ("pierś z kurczaka") — small bonus when it matches.
  if (q.length && alias.t.length && wordSim(alias.t[0], q[0]) > 0) score += 0.02;
  // "olej z suszonych pomidorów" is oil, not tomatoes: with a linking word the first noun must match.
  if (linked && q.length > 1 && !usedQ.has(0)) score *= 0.86;
  if (alias.full === q.join(' ')) score += 0.03;
  return score;
}

export function search(index, query, limit = 20) {
  const q = tokens(query);
  if (!q.length) return [];
  const qr = rawTokens(query);
  const linked = /\s(z|ze|w|we|of|with|in)\s/i.test(` ${fold(query)} `);
  const out = [];
  for (const entry of index) {
    let best = 0;
    for (const a of entry.aliases) {
      const s = scoreAlias(q, qr.length === q.length ? qr : q, a, linked);
      if (s > best) best = s;
    }
    if (entry.food.src === 'custom' && best > 0) best += 0.04; // the user's own foods first
    if (best >= 0.45) out.push({ food: entry.food, score: best });
  }
  out.sort((a, b) => b.score - a.score || (a.food.pl || a.food.name || '').length - (b.food.pl || b.food.name || '').length);
  return out.slice(0, limit);
}

export function confidence(score) {
  if (score >= 0.9) return 'high';
  if (score >= 0.72) return 'medium';
  if (score >= 0.55) return 'low';
  return null;
}

export function bestMatch(index, name) {
  const [top] = search(index, name, 1);
  if (!top) return null;
  const conf = confidence(top.score);
  return conf ? { food: top.food, score: top.score, conf } : null;
}

export const matchKey = (name) => tokens(name).join(' ');

// ---------- grams ----------
const CUP_ML = 240;
const GLASS_ML = 250; // Polish "szklanka"
// Package / cube sizes common in Polish shops, by food id (used only when the recipe says "1 opakowanie" etc.)
const PACK_G = {
  'yeast-dry': 7, 'baking-powder': 30, 'vanilla-sugar': 16, twarog: 250, 'twarog-lean': 250, cottage: 200, feta: 200, mozzarella: 125,
  'mozzarella-light': 125, tofu: 180, 'puff-pastry': 275, 'cream-cheese': 150, yogurt: 400, 'yogurt-greek': 400, 'cream-sour': 200,
  'cream-30': 200, 'cream-36': 200, spinach: 100, 'spinach-frozen': 450, 'mixed-veg': 450, gelatin: 20, 'jelly-dessert': 75,
  'pudding-mix': 40, pasta: 500, rice: 400, buckwheat: 400, millet: 400, tortilla: 250, 'chocolate-dark': 100, 'chocolate-milk': 100,
  'chocolate-white': 100, biscuits: 200, 'berries-frozen': 450, 'rice-noodles': 200, 'egg-noodles': 250, bacon: 150, ham: 100,
  'salmon-smoked': 100, 'chicken-breast': 500, 'pork-ground': 500, 'beef-ground': 500, 'chicken-ground': 500, 'turkey-ground': 500,
};
const CAN_G = { chickpeas: 240, 'beans-red': 240, 'beans-white': 240, 'beans-black': 240, corn: 285, 'peas-canned': 280, 'tuna-water': 120,
  'tuna-oil': 120, 'coconut-milk': 400, 'tomato-canned': 400, 'tomato-puree': 500, 'pineapple-canned': 565, 'peach-canned': 410,
  sardines: 90, 'salmon-canned': 170, 'ham-canned': 300, 'baked-beans': 400, olives: 150, 'chicken-canned': 150 };
const CUBE_G = { butter: 200, margarine: 200, yeast: 100, bouillon: 10, vegeta: 10, lard: 200, 'processed-cheese': 100 };

function density(food) {
  const u = food?.u || {};
  if (u.cup) return u.cup / CUP_ML;
  if (u.tbsp) return u.tbsp / 15;
  if (u.tsp) return u.tsp / 5;
  return 1;
}

const r1 = (x) => Math.round(x * 10) / 10;

export function toGrams(ing, food) {
  const qty = ing.qty ?? null;
  const unit = ing.unit || null;
  const u = food?.u || {};
  const id = food?.id;
  if (ing.grams != null && ing.grams > 0) return { grams: r1(ing.grams), guess: false, how: 'from recipe' };
  if (ing.head) return { grams: 0, guess: false, how: '' };
  if (qty == null && !unit) {
    if (ing.toTaste) return { grams: 0, guess: false, how: 'to taste' };
    if (u.piece) return { grams: r1(u.piece), guess: true, how: '1 pc?' };
    return { grams: null, guess: true, how: '' };
  }
  const q = qty ?? 1;
  const d = density(food);
  const out = (g, guess = false, how = '') => ({ grams: g == null ? null : r1(g), guess, how });
  switch (unit) {
    case 'g': return out(q);
    case 'kg': return out(q * 1000);
    case 'dag': return out(q * 10);
    case 'mg': return out(q / 1000);
    case 'ml': return out(q * d);
    case 'dl': return out(q * 100 * d);
    case 'l': return out(q * 1000 * d);
    case 'floz': return out(q * 29.57 * d);
    case 'oz': return out(q * 28.35);
    case 'lb': return out(q * 453.6);
    case 'cup': return out(q * (u.cup ?? CUP_ML * d), !u.cup, `${q} cup`);
    case 'glass': return out(q * (u.cup ? u.cup * GLASS_ML / CUP_ML : GLASS_ML * d), !u.cup, `${q} × 250 ml`);
    case 'tbsp': return out(q * (u.tbsp ?? (u.cup ? u.cup / 16 : 15 * d)), !u.tbsp && !u.cup);
    case 'tsp': return out(q * (u.tsp ?? (u.tbsp ? u.tbsp / 3 : u.cup ? u.cup / 48 : 5 * d)), !u.tsp && !u.tbsp && !u.cup);
    case 'clove': return out(q * (u.clove ?? 4), !u.clove);
    case 'slice': return out(q * (u.slice ?? 20), !u.slice);
    case 'handful': return out(q * 30, true);
    case 'pinch': return out(q * 0.4, false);
    case 'drop': return out(q * 0.05, false);
    case 'sprig': return out(q * (u.sprig ?? 1), true);
    case 'leaf': return out(q * (u.leaf ?? 0.5), !u.leaf);
    case 'stalk': return out(q * (u.stalk ?? 40), !u.stalk);
    case 'bunch': return out(q * (u.bunch ?? 40), true);
    case 'head': return out(u.head != null ? q * u.head : id === 'garlic' ? q * 45 : null, true);
    case 'scoop': return out(q * (u.scoop ?? 30), !u.scoop);
    case 'bottle': return out(q * 500 * d, true);
    case 'jar': return out(q * 300, true);
    case 'bar': return out(q * (u.bar ?? 100), !u.bar);
    case 'cube': {
      const g = CUBE_G[id] ?? u.cube;
      return out(g != null ? q * g : null, g == null);
    }
    case 'can': {
      const g = CAN_G[id] ?? u.can ?? 400;
      return out(q * g, !(id in CAN_G) && !u.can);
    }
    case 'pack': {
      const g = PACK_G[id] ?? u.pack;
      return out(g != null ? q * g : null, true);
    }
    case 'piece':
    case null:
    default: {
      const g = (ing.size && u[ing.size]) || u.piece || (ing.size === 'large' ? u.large : null);
      if (g) return out(q * g, false, `${q} × ${r1(g)} g`);
      return out(null, true);
    }
  }
}

// Units a user can pick when logging a food: grams plus the food's own portions.
export function unitOptions(food) {
  const opts = [{ key: 'g', label: 'g', grams: 1 }];
  const u = food?.u || {};
  const label = { piece: 'piece', medium: 'medium piece', large: 'large piece', small: 'small piece', slice: 'slice', cup: 'cup (240 ml)',
    tbsp: 'tablespoon', tsp: 'teaspoon', clove: 'clove', scoop: 'scoop', pack: 'package', can: 'can', leaf: 'leaf', stalk: 'stalk',
    cube: 'cube', bar: 'bar', floz: 'fl oz', serving: 'serving' };
  for (const k of ['piece', 'small', 'large', 'slice', 'serving', 'tbsp', 'tsp', 'cup', 'clove', 'scoop', 'can', 'pack', 'cube', 'bar', 'stalk', 'leaf']) {
    if (u[k] && !(k !== 'piece' && k === 'medium')) opts.push({ key: k, label: label[k] || UNIT_LABEL[k] || k, grams: u[k] });
  }
  if (food?.liquid || u.cup) opts.push({ key: 'ml', label: 'ml', grams: density(food) });
  return opts;
}

export function foodLabel(food) {
  if (!food) return '';
  if (food.src === 'db') return food.pl && food.pl !== food.en ? `${food.en} · ${food.pl}` : food.en;
  return food.brand ? `${food.name} · ${food.brand}` : food.name;
}
