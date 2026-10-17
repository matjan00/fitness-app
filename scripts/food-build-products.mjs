// Builds docs/data/products.json — branded products sold in Poland, searched offline in the food picker
// next to the generic table (data/foods.json). Like Fitatu's product base, but from Open Food Facts.
//
//   node scripts/food-build-products.mjs            (≈10-15 min, polite 1 request / s)
//
// Source: Open Food Facts (search.openfoodfacts.org), products tagged "en:poland". Data licence: ODbL —
// the attribution is kept in the file's "source" field and shown in the app.
// The search API returns at most 10 000 hits per query, so the set is split by barcode prefix
// (5900…, 5901…, 2…, 4…) until each piece fits.
// Kept: a name, kcal + protein + carbs + fat per 100 g, and macros that roughly add up to the kcal.
// Duplicates (same name + brand) keep the most scanned one.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'data', 'products.json');
const API = 'https://search.openfoodfacts.org/search';
const BASE = 'countries_tags:"en:poland"';
const FIELDS = 'code,product_name,product_name_pl,product_name_en,brands,nutriments,serving_quantity,product_quantity,quantity,unique_scans_n';
const PAGE = 100, MAX = 10000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(q, page, size = PAGE) {
  const url = `${API}?${new URLSearchParams({ q, page: String(page), page_size: String(size), fields: FIELDS, sort_by: '-unique_scans_n' })}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'FitApp-food-table/1.0 (personal food diary)' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (attempt >= 5) throw e;
      await sleep(3000 * attempt);
    }
  }
}

// Barcode prefixes whose exact count is ≤ 10 000 (split one digit deeper while it is too big).
async function partitions(prefix = '') {
  const q = prefix ? `${BASE} AND code:${prefix}*` : BASE;
  const j = await get(q, 1, 1);
  await sleep(700);
  if (j.is_count_exact && j.count <= MAX) return j.count ? [{ prefix, q, count: j.count }] : [];
  const out = [];
  for (let d = 0; d <= 9; d++) out.push(...await partitions(prefix + d));
  return out;
}

const num = (x) => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
const r1 = (x) => Math.round(x * 10) / 10;

// "150 g", "1,5 kg", "500 ml", "75 cl", "4 x 125 g" → grams (ml counted as g). null when unclear.
export function packGrams(q) {
  const m = String(q || '').toLowerCase().replace(/,/g, '.').match(/^\s*(?:(\d+)\s*[x×]\s*)?(\d+(?:\.\d+)?)\s*(kg|g|gr|ml|cl|l)\b/);
  if (!m) return null;
  const mult = { kg: 1000, g: 1, gr: 1, ml: 1, cl: 10, l: 1000 }[m[3]];
  return (Number(m[1]) || 1) * Number(m[2]) * mult;
}

export function toRow(p) {
  const n = p.nutriments || {};
  let k = num(n['energy-kcal_100g']);
  if (k == null && num(n['energy-kj_100g']) != null) k = num(n['energy-kj_100g']) / 4.184;
  const pr = num(n.proteins_100g), c = num(n.carbohydrates_100g), f = num(n.fat_100g);
  const name = String(p.product_name_pl || p.product_name || p.product_name_en || '').replace(/\s+/g, ' ').trim();
  if (!name || name.length < 2 || k == null || pr == null || c == null || f == null) return null;
  if (k < 0 || k > 900 || pr < 0 || c < 0 || f < 0 || pr + c + f > 101) return null;
  // Macros should roughly explain the kcal (alcohol, fibre and polyols excepted).
  const calc = 4 * pr + 4 * c + 9 * f;
  const alcohol = num(n.alcohol_100g) || num(n.alcohol) || 0;
  if (!alcohol && Math.abs(calc - k) > Math.max(30, 0.3 * k)) return null;
  const brand = (Array.isArray(p.brands) ? p.brands[0] : String(p.brands || '').split(',')[0])?.trim() || '';
  const serving = num(p.serving_quantity);
  const pack = num(p.product_quantity) ?? packGrams(p.quantity);
  return [String(p.code), name, brand, Math.round(k), r1(pr), r1(c), r1(f),
    serving > 0 && serving < 2000 ? r1(serving) : 0, pack > 0 && pack < 20000 ? Math.round(pack) : 0, p.unique_scans_n || 0];
}

async function main() {
  console.log('Splitting the Polish product list…');
  const parts = await partitions();
  console.log(`${parts.length} pieces, ${parts.reduce((s, p) => s + p.count, 0)} products listed`);
  const byCode = new Map();
  let seen = 0;
  for (const part of parts) {
    const pages = Math.ceil(part.count / PAGE);
    for (let pg = 1; pg <= pages; pg++) {
      const j = await get(part.q, pg);
      for (const p of j.hits || []) {
        seen++;
        const row = toRow(p);
        if (row && !byCode.has(row[0])) byCode.set(row[0], row);
      }
      await sleep(1000);
    }
    console.log(`  ${part.prefix || '*'}: ${part.count} listed, ${byCode.size} kept so far`);
  }
  // Same name + brand → keep the most scanned.
  const byName = new Map();
  for (const row of byCode.values()) {
    const key = `${row[1].toLowerCase()}|${row[2].toLowerCase()}`;
    const old = byName.get(key);
    if (!old || row[9] > old[9]) byName.set(key, row);
  }
  const rows = [...byName.values()].sort((a, b) => b[9] - a[9] || a[1].localeCompare(b[1]));
  const out = {
    v: 1,
    source: 'Open Food Facts (openfoodfacts.org), products sold in Poland. Database licence ODbL, contents DbCL. Values per 100 g.',
    built: new Date().toISOString().slice(0, 10),
    cols: ['code', 'name', 'brand', 'k', 'p', 'c', 'f', 'serving', 'pack', 'scans'],
    rows,
  };
  fs.writeFileSync(OUT, JSON.stringify(out).replace(/\],\[/g, '],\n['));
  console.log(`Read ${seen}, wrote ${rows.length} products → ${path.relative(process.cwd(), OUT)} (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
