import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { estimateMain, estimateTime, estimateServings, ownView, effectiveLib, sortRecipes, isVegetarianNames } from '../docs/food-estimate.js';
import { filterRecipes } from '../docs/food-library.js';
import { metaPatch, libToOwn } from '../docs/food-copy.js';

const per = (r) => ({ kcal: r.servings ? Math.round((r.totals?.kcal || 0) / r.servings) : 0, p: 10, c: 10, f: 5 });

test('main ingredient: biggest protein source wins, stock is ignored, falls back to starch / veg', () => {
  const ing = (name, grams, p) => ({ name, grams, food: { p } });
  assert.equal(estimateMain({ title: 'Stew', ingredients: [ing('Chicken thighs', 600, 20), ing('Rice', 300, 7), ing('Egg', 60, 12)] }), 'chicken');
  assert.equal(estimateMain({ title: 'Soup', ingredients: [ing('Beef stock', 1000, 1.1), ing('Onion', 800, 1)] }), 'veggies');
  assert.equal(estimateMain({ title: 'Pasta', ingredients: [ing('Spaghetti', 300, 12), ing('Butter', 20, 1)] }), 'pasta');
  assert.equal(estimateMain({ title: 'Gingerbread', course: 'baking', ingredients: [ing('Eggs', 100, 12), ing('Flour', 400, 10)] }), null);
  assert.equal(estimateMain({ title: 'Salmon bowl', ingredients: [ing('Rice', 200, 7)] }), 'fish');
});

test('time: durations from steps, skips marinating, method defaults', () => {
  assert.equal(estimateTime(['Simmer 20 minutes.', 'Bake 1 hour.']).cook_min, 80);
  assert.equal(estimateTime(['Marinate overnight.', 'Fry for 10 minutes.']).cook_min, 10);
  assert.equal(estimateTime(['Bake until golden.']).cook_min, 35);
  assert.equal(estimateTime(['Mix everything in a bowl'], { title: 'Salad' }).cook_min, 0);
  const t = estimateTime(['Stir.'], { nIngredients: 20 });
  assert.equal(t.prep_min, 30);
});

test('servings: ~600 kcal per main serving, bounded', () => {
  assert.equal(estimateServings(2400, 'main'), 4);
  assert.equal(estimateServings(100, 'main'), 1);
  assert.equal(estimateServings(90000, 'main'), 12);
  assert.equal(estimateServings(3000, 'baking'), 12);
});

test('vegetarian names', () => {
  assert.equal(isVegetarianNames(['tomato', 'basil']), true);
  assert.equal(isVegetarianNames(['tomato', 'Chicken breast']), false);
});

const lib = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'docs', 'data', 'library', 'mealdb.json'), 'utf8')).recipes;
test('every TheMealDB recipe has time, servings, per-serving macros and est flags; no classics remain', () => {
  assert.ok(lib.length >= 9);
  for (const r of lib) {
    assert.ok(r.prep_min + r.cook_min > 0 && r.servings >= 1 && r.per_serving.kcal > 0, r.id);
    assert.ok(r.est && r.est.time && r.est.main, r.id);
    assert.equal(r.source.type, 'themealdb');
  }
  assert.ok(!fs.existsSync(path.join(import.meta.dirname, '..', 'docs', 'data', 'library', 'classics.json')));
});

test('filters: main (multi), time, protein, kcal, source, sort', () => {
  const mk = (id, main, min, kcal, p, src = 'themealdb') => ({ id, title: id, main_ingredient: main, prep_min: min, cook_min: 0, per_serving: { kcal, p }, source: { type: src }, ingredients: [], vegetarian: false });
  const all = [mk('a', 'chicken', 20, 350, 45), mk('b', 'beef', 50, 700, 35), mk('c', 'pasta', 10, 500, 15, 'own'), mk('d', null, 30, 900, 25)];
  const ids = (f) => filterRecipes(all, f).map((r) => r.id).join('');
  assert.equal(ids({ mains: ['chicken', 'pasta'] }), 'ac');
  assert.equal(ids({ maxTime: 30 }), 'acd');
  assert.equal(ids({ minP: 30 }), 'ab');
  assert.equal(ids({ maxKcal: 600 }), 'ac');
  assert.equal(ids({ source: 'own' }), 'c');
  assert.equal(ids({}), 'abcd');
  assert.equal(sortRecipes(all, 'pp100').map((r) => r.id).join(''), 'abcd'.split('').sort((x, y) => { const g = (i) => all.find((r) => r.id === i); return g(y).per_serving.p / g(y).per_serving.kcal - g(x).per_serving.p / g(x).per_serving.kcal; }).join(''));
  assert.equal(sortRecipes(all, 'kcal')[0].id, 'a');
  assert.equal(sortRecipes(all, 'time')[0].id, 'c');
  assert.equal(sortRecipes(all, 'name')[3].id, 'd');
});

test('own recipes are viewable/filterable: times and main are estimated when missing', () => {
  const rec = { id: 'r1', title: 'Chicken rice', servings: 2, steps: ['Fry 10 minutes.'], ingredients: [{ name: 'chicken breast', grams: 400, food: { p: 23 } }, { name: 'rice', grams: 200, food: { p: 7 } }], totals: { kcal: 1000 } };
  const v = ownView(rec, per);
  assert.equal(v.main_ingredient, 'chicken');
  assert.ok(v.est.time && v.prep_min + v.cook_min > 0);
  assert.equal(v.source.type, 'own');
  assert.equal(filterRecipes([v], { mains: ['chicken'], maxTime: 60, source: 'own' }).length, 1);
  const known = ownView({ ...rec, prepMin: 5, cookMin: 10, main_ingredient: 'rice' }, per);
  assert.equal(known.est.time, undefined);
  assert.equal(known.main_ingredient, 'rice');
});

test('editing time / servings / main clears the estimate flag and works on a library copy', () => {
  const r = lib[0];
  const own = libToOwn(r, {});
  assert.equal(own.main_ingredient, r.main_ingredient);
  assert.ok(own.est.time);
  let x = metaPatch(own, 'time', { prep: 10, cook: 25 });
  assert.equal(x.prepMin, 10); assert.equal(x.cookMin, 25); assert.equal(x.est.time, false); assert.equal(x.est.main, true);
  x = metaPatch(x, 'servings', 2);
  assert.equal(x.servings, 2); assert.equal(x.est.servings, false);
  x = metaPatch(x, 'main', 'fish');
  assert.equal(x.main_ingredient, 'fish'); assert.equal(x.est.main, false);
  const eff = effectiveLib(r, x, per);
  assert.equal(eff.main_ingredient, 'fish'); assert.equal(eff.prep_min, 10); assert.equal(eff.copy, true);
});
