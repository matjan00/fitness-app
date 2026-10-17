import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fromRows, buildProductIndex, searchProducts } from '../docs/food-products.js';
import { toRow, packGrams } from '../scripts/food-build-products.mjs';

const rows = [
  ['1', 'Twaróg półtłusty', 'Piątnica', 132, 18, 3.7, 4, 0, 250, 40],
  ['2', 'Serek wiejski lekki', 'Piątnica', 72, 12, 2, 1.8, 150, 200, 25],
  ['3', 'Serniczek z twarogiem i rodzynkami', 'Biedronka', 310, 7, 40, 13, 0, 0, 3],
  ['4', 'Twaróg chudy', 'Mlekovita', 99, 19.8, 3.6, 0.5, 0, 250, 12],
  ['5', 'Jogurt naturalny', 'Bakoma', 61, 4.3, 6, 2.2, 0, 400, 30],
  ['6', 'Skyr pitny wanilia', 'Piątnica', 65, 8, 7.5, 0, 330, 330, 8],
];
const foods = fromRows({ rows });
const index = buildProductIndex(foods);
const names = (q, n = 10) => searchProducts(index, q, n).map((r) => r.food.name);

test('rows become foods the picker and diary can use', () => {
  const f = foods[1];
  assert.equal(f.src, 'off');
  assert.equal(f.id, 'off:2');
  assert.equal(f.brand, 'Piątnica');
  assert.deepEqual(f.u, { serving: 150, pack: 200 });
  assert.equal(foods[0].u.serving, undefined);
  assert.equal(foods[2].u, undefined);
});

test('search: plain name, diacritics, partial typing, brand', () => {
  assert.deepEqual(names('twaróg').slice(0, 2).sort(), ['Twaróg chudy', 'Twaróg półtłusty']);
  assert.equal(names('twarog polt')[0], 'Twaróg półtłusty');
  assert.equal(names('twar')[0].startsWith('Twaróg'), true);
  assert.deepEqual(names('piątnica twaróg'), ['Twaróg półtłusty']);
  assert.deepEqual(names('skyr'), ['Skyr pitny wanilia']);
  assert.equal(names('jogurtu')[0], 'Jogurt naturalny'); // Polish ending
});

test('search: every word must match, shorter names first', () => {
  assert.deepEqual(names('twaróg kakao'), []);
  assert.deepEqual(names('xyz'), []);
  assert.deepEqual(names(''), []);
  const t = names('twarog');
  assert.ok(t.indexOf('Serniczek z twarogiem i rodzynkami') > t.indexOf('Twaróg chudy'));
});

test('importer keeps complete, sane products only', () => {
  const p = { code: '590', product_name_pl: 'Kefir', brands: ['Bieluch'], unique_scans_n: 4, serving_quantity: 250,
    nutriments: { 'energy-kcal_100g': 50, proteins_100g: 3.4, carbohydrates_100g: 4.7, fat_100g: 2 } };
  assert.deepEqual(toRow(p), ['590', 'Kefir', 'Bieluch', 50, 3.4, 4.7, 2, 250, 0, 4]);
  assert.equal(toRow({ ...p, nutriments: { ...p.nutriments, fat_100g: undefined } }), null); // missing fat
  assert.equal(toRow({ ...p, nutriments: { ...p.nutriments, 'energy-kcal_100g': 400 } }), null); // macros don't add up
  assert.equal(toRow({ ...p, product_name_pl: '', product_name: '' }), null);
  const kj = toRow({ ...p, nutriments: { ...p.nutriments, 'energy-kcal_100g': undefined, 'energy-kj_100g': 209 } });
  assert.equal(kj[3], 50);
  assert.equal(toRow({ ...p, quantity: '1 l' })[8], 1000);
  assert.equal(packGrams('150 g'), 150);
  assert.equal(packGrams('1,5 kg'), 1500);
  assert.equal(packGrams('75 cl'), 750);
  assert.equal(packGrams('4 x 125 g'), 500);
  assert.equal(packGrams('6 sztuk'), null);
});

test('bundled product list is sane', { skip: !fs.existsSync(new URL('../docs/data/products.json', import.meta.url)) }, () => {
  const url = new URL('../docs/data/products.json', import.meta.url);
  const j = JSON.parse(fs.readFileSync(url, 'utf8'));
  assert.match(j.source, /Open Food Facts/);
  assert.ok(j.rows.length > 3000, `only ${j.rows.length} products`);
  assert.ok(fs.statSync(url).size < 6e6);
  const all = fromRows(j);
  const ids = new Set(all.map((f) => f.id));
  assert.equal(ids.size, all.length);
  const idx = buildProductIndex(all);
  const t0 = performance.now();
  for (const q of ['twaróg', 'jogurt naturalny', 'mleko 2', 'chleb', 'piątnica', 'kabanos', 'skyr']) assert.ok(searchProducts(idx, q).length, q);
  assert.ok(performance.now() - t0 < 1500, 'search too slow');
});
