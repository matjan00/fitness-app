import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateRecipe, filterRecipes, fitsMyDay, displayIngredient, toggleFav, markCooked, totalMin } from '../docs/food-library.js';
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
  assert.deepEqual(fitsMyDay(list, { kcal: 500, p: 40 }).map((r) => r.id), ['a', 'c']);
  assert.deepEqual(fitsMyDay(list, { kcal: 100, p: 40 }), []);
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
