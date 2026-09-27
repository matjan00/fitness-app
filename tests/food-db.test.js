import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseIngredient } from '../docs/food-parse.js';
import { buildIndex, bestMatch, search, toGrams, matchKey, unitOptions } from '../docs/food-db.js';

const data = JSON.parse(fs.readFileSync(new URL('../docs/data/foods.json', import.meta.url), 'utf8'));
const foods = data.foods.map((f) => ({ ...f, src: 'db' }));
const index = buildIndex(foods);
const byId = (id) => foods.find((f) => f.id === id);

test('food table is sane and compact', () => {
  assert.ok(foods.length >= 400, `only ${foods.length} foods`);
  assert.ok(fs.statSync(new URL('../docs/data/foods.json', import.meta.url)).size < 400 * 1024);
  const ids = new Set();
  for (const f of foods) {
    assert.ok(!ids.has(f.id), `duplicate ${f.id}`);
    ids.add(f.id);
    assert.ok(f.en && f.pl, f.id);
    for (const k of ['k', 'p', 'c', 'f']) assert.ok(typeof f[k] === 'number' && f[k] >= 0, `${f.id}.${k}`);
    // Atwater sanity check: kcal roughly matches macros (alcohol & polyols excepted)
    // (alcohol, and a few high-fibre / leavening items where USDA uses specific energy factors)
    if (!['vodka', 'wine-red', 'wine-white', 'beer', 'vanilla-extract', 'baking-powder', 'cocoa', 'allspice', 'cloves', 'dill-dried', 'oat-bran', 'wheat-bran'].includes(f.id)) {
      const fb = f.fb || 0;
      const est = f.p * 4 + (f.c - fb) * 4 + fb * 2 + f.f * 9;
      assert.ok(Math.abs(est - f.k) <= Math.max(25, f.k * 0.22), `${f.id}: ${f.k} kcal vs ${est}`);
    }
  }
  assert.equal(byId('egg').u.large, 50);
  assert.equal(byId('garlic').u.clove, 3);
});

const expectMatch = [
  ['200 g mąki pszennej', 'flour'], ['2 łyżki oliwy z oliwek', 'olive-oil'], ['1 duża cebula', 'onion'], ['Szczypta soli', 'salt'],
  ['½ szklanki mleka', 'milk'], ['1 1/2 cups flour', 'flour'], ['2 cloves garlic', 'garlic'], ['3 jajka', 'egg'], ['8 jajek', 'egg'],
  ['pół kostki masła', 'butter'], ['polędwica wołowa 300 g', 'beef-tenderloin'], ['2 ząbki czosnku', 'garlic'],
  ['400g pomidorów z puszki', 'tomato-canned'], ['1 kg ziemniaków', 'potato'], ['500 g piersi z kurczaka', 'chicken-breast'],
  ['400 g udek z kurczaka', 'chicken-thigh'], ['1 łyżeczka papryki słodkiej', 'paprika'], ['150 ml śmietanki 30%', 'cream-30'],
  ['garść szpinaku', 'spinach'], ['30 g parmezanu', 'parmesan'], ['200 g makaronu penne', 'pasta'], ['150 g ryżu basmati', 'rice'],
  ['3 łyżki sosu sojowego', 'soy-sauce'], ['1 łyżka miodu', 'honey'], ['2 cukinie', 'zucchini'], ['4 łyżki mąki', 'flour'],
  ['250 g twarogu półtłustego', 'twarog'], ['1 kostka drożdży', 'yeast'], ['1 puszka ciecierzycy', 'chickpeas'],
  ['100 g kaszy gryczanej', 'buckwheat'], ['50 g płatków owsianych', 'oats'], ['1 banan', 'banana'], ['2 pomidory', 'tomato'],
  ['1 łyżka masła orzechowego', 'peanut-butter'], ['200 g serka wiejskiego', 'cottage'], ['2 łyżki jogurtu greckiego', 'yogurt-greek'],
  ['1 łyżka oleju', 'oil'], ['200 g krewetek', 'shrimp'], ['1 papryka czerwona', 'pepper-red'], ['3 eggs', 'egg'],
  ['50g egg whites', 'egg-white'], ['2 tbsp olive oil', 'olive-oil'], ['1 avocado', 'avocado'], ['100 g kaszy jaglanej', 'millet'],
  ['1 marchewka', 'carrot'], ['200 ml mleczka kokosowego', 'coconut-milk'], ['1 łyżeczka cynamonu', 'cinnamon'],
  ['2 łyżki cukru pudru', 'sugar-powdered'], ['1 łyżka koncentratu pomidorowego', 'tomato-paste'], ['200 g łososia', 'salmon'],
  ['300 g mięsa mielonego wołowego', 'beef-ground'], ['kefir 400 ml', 'kefir'], ['250 ml maślanki', 'buttermilk'],
  ['2 łyżki śmietany 18%', 'cream-sour'], ['1 szklanka bulionu', 'broth-chicken'], ['1 ogórek kiszony', 'pickle'],
  ['3 łyżki oleju z suszonych pomidorów', 'oil'], ['1 op. cukru wanilinowego', 'vanilla-sugar'], ['2 łyżki oliwy z oliwek', 'olive-oil'],
  ['4 średnie ząbki czosnku', 'garlic'],
];

test('ingredient names match the right food', () => {
  for (const [line, id] of expectMatch) {
    const ing = parseIngredient(line);
    const m = bestMatch(index, ing.name);
    assert.ok(m, `no match for ${line}`);
    assert.equal(m.food.id, id, `${line} → ${m.food.id}`);
  }
});

test('diacritics matter for ties but are optional when typing', () => {
  assert.equal(bestMatch(index, 'mąki').food.id, 'flour');
  assert.equal(bestMatch(index, 'maka').food.id, 'flour');
  assert.equal(bestMatch(index, 'mak').food.id, 'poppy-seeds');
  assert.equal(bestMatch(index, 'kurczak').food.id, 'chicken-breast');
  assert.equal(bestMatch(index, 'qwertyuiop'), null);
});

test("the user's own foods are found by their first words and ranked first", () => {
  const own = { src: 'custom', id: 'x1', name: 'Twaróg półtłusty Piątnica', k: 133, p: 18, c: 3.5, f: 5 };
  const idx2 = buildIndex([own, ...foods]);
  assert.equal(search(idx2, 'twaróg', 3)[0].food.id, 'x1');
  assert.equal(bestMatch(idx2, 'twarogu półtłustego').food.id, 'x1');
});

test('search returns ranked results', () => {
  const r = search(index, 'ser', 10).map((x) => x.food.id);
  assert.ok(r.length > 1);
  const r2 = search(index, 'chicken', 5).map((x) => x.food.id);
  assert.ok(r2.includes('chicken-breast'));
});

test('matchKey is stable across inflection-free differences', () => {
  assert.equal(matchKey('Mąki  pszennej'), matchKey('mąki pszennej'));
  assert.equal(matchKey('drobno posiekana cebula'), 'cebula');
});

const G = (line, id) => toGrams(parseIngredient(line), byId(id));

test('unit → grams conversion', () => {
  assert.equal(G('200 g mąki', 'flour').grams, 200);
  assert.equal(G('1,5 kg ziemniaków', 'potato').grams, 1500);
  assert.equal(G('25 dag sera', 'gouda').grams, 250);
  assert.equal(G('2 łyżki oliwy', 'olive-oil').grams, 27);
  assert.equal(G('1 łyżeczka cukru', 'sugar').grams, 4.2);
  assert.equal(G('1 cup rice', 'rice').grams, 185);
  assert.equal(G('1 szklanka mąki', 'flour').grams, 130.2);
  assert.equal(G('3 jajka', 'egg').grams, 132);
  assert.equal(G('2 duże jajka', 'egg').grams, 100);
  assert.equal(G('2 ząbki czosnku', 'garlic').grams, 6);
  assert.equal(G('pół kostki masła', 'butter').grams, 100);
  assert.equal(G('1 kostka drożdży', 'yeast').grams, 100);
  assert.equal(G('1 puszka ciecierzycy', 'chickpeas').grams, 240);
  assert.equal(G('1 puszka pomidorów', 'tomato-canned').grams, 400);
  assert.equal(G('1 cebula (ok. 150 g)', 'onion').grams, 150);
  assert.equal(G('8 oz cream cheese', 'cream-cheese').grams, 226.8);
  assert.equal(G('Szczypta soli', 'salt').grams, 0.4);
  assert.equal(G('sól do smaku', 'salt').grams, 0);
  assert.equal(G('250 ml mleka', 'milk').grams > 250, true);
  const unknown = G('1 opakowanie czegoś', 'onion');
  assert.equal(unknown.grams, null);
  assert.equal(unknown.guess, true);
  assert.equal(G('garść szpinaku', 'spinach').guess, true);
});

test('unit options for logging', () => {
  const o = unitOptions(byId('egg')).map((x) => x.key);
  assert.ok(o.includes('g') && o.includes('piece'));
  assert.deepEqual(unitOptions({ k: 100, p: 1, c: 1, f: 1 }).map((x) => x.key), ['g']);
});
