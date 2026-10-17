import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateRecipe, filterRecipes, fitsMyDay, displayIngredient, toggleFav, markCooked, totalMin, planLibraryCleanup } from '../docs/food-library.js';
import { loadIndex, convertIngredient, convertRecipe, fToC, splitSteps, estimateTimes, mealCourse } from '../scripts/library/convert.mjs';

const ctx = loadIndex();
const dir = path.join(import.meta.dirname, '..', 'docs', 'data', 'library');

test('units convert to grams through the food table', () => {
  assert.equal(convertIngredient('200 g pasta', ctx.index).row.grams, 200);
  assert.equal(convertIngredient('2 oz butter', ctx.index).row.grams, 56.7);
  const cup = convertIngredient('1 cup flour', ctx.index).row;
  assert.equal(cup.food_id, 'flour');
  assert.ok(cup.grams > 100 && cup.grams < 160);
  assert.equal(convertIngredient('1 tbsp olive oil', ctx.index).row.grams > 10, true);
  assert.equal(convertIngredient('As required Salt', ctx.index).row.grams, 0);
  assert.equal(convertIngredient('2 dragonfruit powder blend', ctx.index).row.conf, 'check');
});

test('recipe conversion gives per-serving macros and flags', () => {
  const r = convertRecipe({ id: 't1', title: 'Chicken and rice', cuisine: 'international', course: 'main', servings: 2, prep_min: 5, cook_min: 20, difficulty: 'easy',
    ingredients: ['200 g chicken breast', '100 g rice'], steps: ['Cook.'], source: { type: 'themealdb', name: 'x', url: 'https://x.org', license: 'PD' } }, ctx);
  assert.equal(r.vegetarian, false);
  assert.equal(r.main_ingredient, 'chicken');
  assert.ok(r.per_serving.kcal > 250 && r.per_serving.kcal < 450);
  assert.deepEqual(validateRecipe(r), []);
});

test('helpers: temperature, steps, times, course', () => {
  assert.equal(fToC('Heat oven to 350F.'), 'Heat oven to 175°C.');
  assert.equal(fToC('180 C'), '180 C');
  assert.deepEqual(splitSteps('STEP 1\r\nMix.\r\nSTEP 2\r\nBake.'), ['Mix.', 'Bake.']);
  assert.equal(estimateTimes(['Simmer for 20 minutes.', 'Bake 1 hour.']).cook_min, 80);
  assert.equal(mealCourse({ strMeal: 'Rosol', strCategory: 'Chicken' }), 'soup');
});

test('scaling ingredient lines', () => {
  const g = { text: '200 g rice', qty: 200, unit: 'g', name: 'rice', grams: 200 };
  assert.equal(displayIngredient(g, 1.5), '300 g rice');
  assert.equal(displayIngredient({ text: '2 eggs', qty: 2, unit: null, name: 'eggs', grams: null }, 2), '4 eggs');
  assert.equal(displayIngredient({ text: 'salt', qty: null, name: 'salt', grams: 0 }, 2), 'salt');
});

test('filters, favourites, fits-my-day', () => {
  const mk = (id, kcal, p, extra = {}) => ({ id, title: id, cuisine: 'italian', course: 'main', prep_min: 10, cook_min: 20, difficulty: 'easy', vegetarian: false, main_ingredient: 'pasta', ingredients: [{ name: 'x', text: 'x' }], per_serving: { kcal, p, c: 0, f: 0 }, ...extra });
  const list = [mk('a', 400, 30), mk('b', 800, 10, { vegetarian: true, cook_min: 90 }), mk('c', 250, 5, { cuisine: 'polish' })];
  assert.deepEqual(filterRecipes(list, { cuisine: 'italian' }).map((r) => r.id), ['a', 'b']);
  assert.deepEqual(filterRecipes(list, { maxTime: 45 }).map((r) => r.id), ['a', 'c']);
  assert.deepEqual(filterRecipes(list, { veg: true }).map((r) => r.id), ['b']);
  assert.deepEqual(filterRecipes(list, { minP: 20, maxKcal: 500 }).map((r) => r.id), ['a']);
  assert.deepEqual(filterRecipes(list, { fav: true }, new Set(['c'])).map((r) => r.id), ['c']);
  assert.equal(totalMin(list[1]), 100);
  assert.deepEqual(fitsMyDay(list, { kcal: 500, p: 40 }, { hour: 19 }).list.map((r) => r.id), ['a', 'c']);
  assert.deepEqual(fitsMyDay(list, { kcal: 100, p: 40 }, { hour: 19 }).list, []);
  assert.equal(fitsMyDay(list, { kcal: -50, p: 0 }, { hour: 19 }).over, true);
  let st = toggleFav({}, 'a'); assert.deepEqual(st.favs, ['a']); st = toggleFav(st, 'a'); assert.deepEqual(st.favs, []);
  assert.equal(markCooked(markCooked({}, 'a', 3, '2026-01-01'), 'a', 5, '2026-01-02').cooked.a.n, 2);
});

test('every library JSON file is valid and consistent', () => {
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const seen = new Set();
  let total = 0;
  for (const s of idx.sources) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, s.file), 'utf8'));
    assert.equal(j.recipes.length, s.count, s.file);
    for (const r of j.recipes) {
      assert.deepEqual(validateRecipe(r), [], r.id);
      assert.ok(!seen.has(r.id), `duplicate ${r.id}`); seen.add(r.id);
      assert.ok(r.per_serving.kcal > 50 && r.per_serving.kcal < 1500, `${r.id} kcal ${r.per_serving.kcal}`);
      assert.ok(r.checks <= r.ingredients.length / 2, `${r.id} has too many unmatched ingredients`);
      total++;
    }
  }
  assert.equal(total, Object.values(idx.cuisines).reduce((a, b) => a + b, 0));
});

test('retiring the library keeps favourited, cooked and edited recipes, deletes the rest', () => {
  const lib = ['a', 'b', 'c', 'd'].map((id) => ({ id, title: id }));
  const own = [{ id: 'mine', title: 'Mine' }, { id: 'copyC', title: 'C edited', from_library: 'c' }];
  const state = { favs: ['a', 'gone'], cooked: { b: { rating: 5, n: 1 } } };
  const entries = [{ id: 'e1', source: { type: 'library', id: 'a' } }, { id: 'e2', source: { type: 'library', id: 'd' } }];
  let n = 0;
  const plan = planLibraryCleanup(lib, own, state, entries, (r) => ({ title: r.title, from_library: r.id }), () => `new${++n}`);
  assert.deepEqual(plan.put.map((r) => [r.id, r.imported_from, 'from_library' in r]), [['new1', 'a', false], ['new2', 'b', false], ['copyC', 'c', false]]);
  assert.deepEqual(plan.remove, ['a', 'b', 'c', 'd']);
  assert.deepEqual(plan.state.favs, ['own-new1', 'gone']);
  assert.deepEqual(Object.keys(plan.state.cooked), ['own-new2']);
  assert.deepEqual(plan.entries, [{ id: 'e1', source: { type: 'recipe', id: 'new1' } }]);
  // Running again (records not yet gone after a partial sync) creates no duplicates.
  const again = planLibraryCleanup(lib, [...own, ...plan.put], plan.state, [], () => assert.fail('no new copy'), () => 'x');
  assert.equal(again.put.length, 0);
});

test('Fits my day sizes meals to what is left for the rest of the day', () => {
  const mk = (id, kcal, p, meals = []) => ({ id, title: id, prep_min: 0, cook_min: 0, ingredients: [], meals, per_serving: { kcal, p, c: 0, f: 0 } });
  const list = [mk('huge', 1900, 90), mk('lunch', 650, 50, ['lunch']), mk('omelette', 600, 40, ['breakfast']), mk('nocount', 0, 0)];
  // 13:00 with 2000 kcal left: two meals to go, so ~1000 kcal now; the 1900 kcal dish is not first, uncounted is skipped.
  const noon = fitsMyDay(list, { kcal: 2000, p: 140 }, { hour: 13 });
  assert.equal(noon.meal, 'lunch');
  assert.equal(noon.list[0].id, 'lunch');
  assert.ok(!noon.list.some((r) => r.id === 'nocount'));
  // In the evening a breakfast-only recipe ranks below one for any meal.
  const eve = fitsMyDay([mk('omelette', 600, 40, ['breakfast']), mk('bowl', 600, 40)], { kcal: 700, p: 60 }, { hour: 19 });
  assert.deepEqual(eve.list.map((r) => r.id), ['bowl', 'omelette']);
});

test('filters: any main ingredient, uncounted recipes never pass kcal/protein filters, search finds matched foods', () => {
  const mk = (id, kcal, extra = {}) => ({ id, title: id, prep_min: 0, cook_min: 0, per_serving: { kcal, p: 30, c: 0, f: 0 }, ingredients: [], ...extra });
  const list = [mk('bowl', 500, { mains: ['chicken', 'rice'] }), mk('zero', 0, { mains: ['rice'] }), mk('pierogi', 600, { ingredients: [{ name: 'filet', food: { name: 'Pierś z kurczaka', en: 'Chicken breast' } }] })];
  assert.deepEqual(filterRecipes(list, { mains: ['rice'] }).map((r) => r.id), ['bowl', 'zero']);
  assert.deepEqual(filterRecipes(list, { maxKcal: 600 }).map((r) => r.id), ['bowl', 'pierogi']);
  assert.deepEqual(filterRecipes(list, { minP: 20 }).map((r) => r.id), ['bowl', 'pierogi']);
  assert.deepEqual(filterRecipes(list, { q: 'piers' }).map((r) => r.id), ['pierogi']);
});
