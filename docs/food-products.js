// Branded products sold in Poland (data/products.json, built by scripts/food-build-products.mjs from
// Open Food Facts). Searched offline in the food picker, next to the generic table. Pure logic (no DOM).
//
//   loadProducts()                   → [food] with src 'off', id 'off:<barcode>' (same shape as an online OFF hit)
//   buildProductIndex(products)      → index for searchProducts
//   searchProducts(index, q, limit)  → [{ food, score }], best first; every query word must match
//
// Kept separate from food-db.js on purpose: recipe ingredient matching only uses the generic table.

import { tokens } from './food-db.js';

let promise = null;
let cache = null;
export function loadProducts(url = 'data/products.json') {
  if (cache) return Promise.resolve(cache);
  if (!promise) {
    promise = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`Could not load the product list (${r.status})`);
      return r.json();
    }).then((j) => (cache = fromRows(j))).catch((e) => { promise = null; throw e; });
  }
  return promise;
}

export function fromRows(j) {
  return (j.rows || []).map(([code, name, brand, k, p, c, f, serving, pack, scans]) => {
    const food = { src: 'off', id: `off:${code}`, name, brand: brand || null, k, p, c, f, scans: scans || 0 };
    const u = {};
    if (serving > 0) u.serving = serving;
    if (pack > 0) u.pack = pack;
    if (u.serving || u.pack) food.u = u;
    return food;
  });
}

// Words of name + brand, and a bucket per word's first two letters (candidate lookup).
export function buildProductIndex(products) {
  const entries = products.map((food) => {
    const name = tokens(food.name);
    const brand = food.brand ? tokens(food.brand) : [];
    return { food, name, words: [...new Set([...name, ...brand])] };
  });
  const buckets = new Map();
  entries.forEach((e, i) => {
    for (const w of e.words) {
      const k = w.slice(0, 2);
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = new Set()));
      b.add(i);
    }
  });
  return { entries, buckets };
}

// 1 exact, 0.92 the typed word is the start of the product word ("twar" → "twarog"),
// ~0.85 same stem with a different ending ("jogurtu" ~ "jogurt"), 0 otherwise.
function wordScore(q, w) {
  if (q === w) return 1;
  if (q.length >= 2 && w.startsWith(q)) return q.length >= 3 ? 0.92 : 0.8;
  if (/^\d/.test(q)) return 0;
  const n = Math.min(q.length, w.length);
  let p = 0;
  while (p < n && q[p] === w[p]) p++;
  if (p < 3 || p < n - 2 || Math.max(q.length, w.length) - p > 3) return 0;
  return 0.85;
}

export function searchProducts(index, query, limit = 30) {
  const q = tokens(query);
  if (!q.length || !index?.entries.length) return [];
  // Candidates: products having a word that starts like every query word.
  let cand = null;
  for (const t of q) {
    const b = index.buckets.get(t.slice(0, 2));
    if (!b) return [];
    if (!cand) cand = [...b];
    else cand = cand.filter((i) => b.has(i));
    if (!cand.length) return [];
  }
  const out = [];
  for (const i of cand) {
    const e = index.entries[i];
    let sum = 0;
    let nameHits = 0;
    let ok = true;
    for (const t of q) {
      let best = 0, inName = false;
      for (const w of e.words) {
        const s = wordScore(t, w);
        if (s > best) { best = s; inName = e.name.includes(w); }
      }
      if (!best) { ok = false; break; }
      sum += best;
      if (inName) nameHits++;
    }
    if (!ok) continue;
    // Share of the product name the query covers: "twaróg" ranks "Twaróg półtłusty" above
    // "Serniczek z twarogiem i rodzynkami".
    const cover = Math.min(1, nameHits / Math.max(1, e.name.length));
    const first = e.name.length && wordScore(q[0], e.name[0]) > 0 ? 0.05 : 0;
    const popular = Math.min(0.06, Math.log10(1 + e.food.scans) * 0.02); // often-scanned products a bit higher
    out.push({ food: e.food, score: sum / q.length * 0.7 + cover * 0.25 + first + popular });
  }
  out.sort((a, b) => b.score - a.score || b.food.scans - a.food.scans || a.food.name.length - b.food.name.length);
  return out.slice(0, limit);
}
