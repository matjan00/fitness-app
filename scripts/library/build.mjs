// Builds docs/data/library/*.json + index.json.   Usage: node scripts/library/build.mjs [mealdb|classics|myplate ...]
// mealdb: reads scripts/library/mealdb-ids.json ({cuisine: [ids]}), fetches each meal from TheMealDB (test key 1).
// classics: scripts/library/classics.json (hand-written). myplate: scripts/library/myplate.json when present (see LIBRARY-PLAN.md).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadIndex, convertRecipe, mealdbToRaw, DOCS } from './convert.mjs';
import { validateRecipe } from '../../docs/food-library.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DOCS, 'data', 'library');
const ctx = loadIndex();
const want = process.argv.slice(2);
const run = (k) => !want.length || want.includes(k);
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SOURCES = { mealdb: 'TheMealDB', classics: 'Classic cookbooks (rewritten)', myplate: 'USDA MyPlate Kitchen' };

async function rawFor(key) {
  if (key === 'classics') return readJson('classics.json').recipes;
  if (key === 'myplate') return fs.existsSync(path.join(here, 'myplate.json')) ? readJson('myplate.json').recipes : [];
  const ids = readJson('mealdb-ids.json');
  const ovs = readJson('mealdb-overrides.json');
  const out = [];
  for (const list of Object.values(ids)) {
    for (const id of list) {
      const r = await fetch(`https://www.themealdb.com/api/json/v1/1/lookup.php?i=${id}`);
      const meal = (await r.json()).meals?.[0];
      if (!meal) { console.warn('missing meal', id); continue; }
      out.push(mealdbToRaw(meal, ovs[id] || {}));
      await sleep(300);
    }
  }
  return out;
}

for (const key of Object.keys(SOURCES)) {
  if (!run(key)) continue;
  const recipes = (await rawFor(key)).map((r) => convertRecipe(r, ctx));
  for (const r of recipes) { const e = validateRecipe(r); if (e.length) console.warn('INVALID', r.id, e.join(', ')); }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${key}.json`), JSON.stringify({ source: key, recipes }, null, 0) + '\n');
  for (const r of recipes) console.log(`${key.padEnd(8)} ${r.title.slice(0, 34).padEnd(34)} ${String(r.per_serving.kcal).padStart(4)} kcal P${String(r.per_serving.p).padStart(5)}  checks ${r.checks}/${r.ingredients.length}`);
}

// index over whatever files exist
const sources = [];
const cuisines = {};
for (const key of Object.keys(SOURCES)) {
  const f = path.join(OUT, `${key}.json`);
  if (!fs.existsSync(f)) continue;
  const rs = JSON.parse(fs.readFileSync(f, 'utf8')).recipes;
  if (!rs.length) continue;
  sources.push({ key, name: SOURCES[key], file: `${key}.json`, count: rs.length });
  for (const r of rs) cuisines[r.cuisine] = (cuisines[r.cuisine] || 0) + 1;
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ v: 1, sources, cuisines }) + '\n');
console.log('index:', JSON.stringify(cuisines));
