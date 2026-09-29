import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkRecipe, applyFix, ignoreWarning, rowKcal } from '../docs/food-check.js';
import { libToOwn } from '../docs/food-copy.js';
import { recipeTotals } from '../docs/food-calc.js';

const dir = path.join(import.meta.dirname, '..', 'docs', 'data');
const foods = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(dir, 'foods.json'), 'utf8')).foods.map((f) => [f.id, { ...f, src: 'db' }]));
const snap = (id) => { const f = foods[id]; return { src: 'db', id, name: f.en, en: f.en, k: f.k, p: f.p, c: f.c, f: f.f }; };
const ing = (raw, id, grams, extra = {}) => ({ raw, name: raw.replace(/^[\d.,\s]*(g|ml|kg)?\s*/i, ''), grams, hint: grams, food: id ? snap(id) : null, conf: 'high', ...extra });
const check = (ings, servings = 2) => checkRecipe(ings, servings, foods);
const kinds = (w) => w.map((x) => x.kind);

test('raw vs cooked: "cooked rice" counted as dry rice is flagged and fixable', () => {
  const ings = [ing('300 g cooked rice', 'rice', 300), ing('200 g chicken breast', 'chicken-breast', 200)];
  const w = check(ings);
  assert.equal(w[0].kind, 'cooked');
  assert.equal(w[0].dir, 'over');
  assert.equal(w[0].i, 0);
  assert.ok(w[0].kcal >= 300, `impact ${w[0].kcal}`);
  assert.equal(w[0].fix.patch.foodId, 'rice-cooked');
  const fixed = applyFix(ings[0], w[0].fix, foods);
  assert.equal(fixed.food.id, 'rice-cooked');
  assert.equal(fixed.grams, 300);
  assert.equal(fixed.conf, 'user');
  assert.deepEqual(check([fixed, ings[1]]), []);
  assert.ok(recipeTotals(ings).kcal - recipeTotals([fixed, ings[1]]).kcal > 600);
});

test('raw vs cooked: pasta, kasza (buckwheat) and lentils; cooked food with a plain name is flagged the other way', () => {
  assert.equal(check([ing('250 g boiled pasta', 'pasta', 250)])[0].fix.patch.foodId, 'pasta-cooked');
  assert.equal(check([ing('200 g ugotowana kasza gryczana', 'buckwheat', 200)])[0].fix.patch.foodId, 'buckwheat-cooked');
  assert.equal(check([ing('200 g cooked lentils', 'lentils', 200)])[0].fix.patch.foodId, 'lentils-cooked');
  const rev = check([ing('250 g rice', 'rice-cooked', 250)]);
  assert.equal(rev[0].kind, 'cooked');
  assert.equal(rev[0].dir, 'under');
  assert.equal(rev[0].fix.patch.foodId, 'rice');
  assert.deepEqual(check([ing('250 g rice', 'rice', 250)]), []);
  assert.deepEqual(check([ing('200 g cooked rice', 'rice', 200, { conf: 'user' })]), []);
});

test('bone-in weights: 70 % edible, one tap to apply, then no more warning', () => {
  const ings = [ing('1000 g chicken legs', 'chicken-thigh-skin', 1000, { conf: 'user' })];
  const w = check(ings, 4);
  assert.equal(w[0].kind, 'bone');
  assert.equal(w[0].dir, 'over');
  assert.equal(w[0].kcal, Math.round((rowKcal(ings[0]) * 0.3) / 4));
  const fixed = applyFix(ings[0], w[0].fix, foods);
  assert.equal(fixed.grams, 700);
  assert.deepEqual(check([fixed], 4), []);
  assert.deepEqual(check([ing('1000 g boneless chicken thighs', 'chicken-thigh', 1000)], 4), []);
  assert.equal(check([ing('1 whole chicken (1.6 kg)', 'chicken-whole', 1600)], 4)[0].kind, 'bone');
});

test('chicken legs matched to chicken breast are caught with a food switch', () => {
  const w = check([ing('460 g chicken legs', 'chicken-breast', 460)], 2);
  assert.equal(w[0].kind, 'cut');
  assert.equal(w[0].fix.patch.foodId, 'chicken-thigh-skin');
  assert.equal(check([ing('300 g chicken wings', 'chicken-breast', 300)], 2)[0].fix.patch.foodId, 'chicken-wing');
});

test('suspicious match: name says oil / cheese but the food is something else', () => {
  const oil = check([ing('100 ml olive oil', 'oat-bran', 100)], 2);
  assert.equal(oil[0].kind, 'match');
  assert.equal(oil[0].dir, 'under');
  assert.equal(check([ing('200 g cheddar cheese', 'oat-bran', 200)], 2)[0].kind, 'match');
  assert.deepEqual(check([ing('50 ml olive oil', 'olive-oil', 45)], 4), []);
  assert.deepEqual(check([ing('sugar snap peas', 'green-beans', 100)], 2), []);
});

test('low-confidence match only shows on a big ingredient', () => {
  const big = [ing('600 g something fatty', 'pork-belly', 600, { conf: 'low' })];
  assert.equal(check(big, 2)[0].dir, 'unsure');
  const small = [ing('600 g pasta', 'pasta-cooked', 600, { conf: 'user' }), ing('5 g something', 'pork-belly', 5, { conf: 'low' })];
  assert.deepEqual(check(small, 2), []);
});

test('vague amounts on calorie-dense items', () => {
  assert.equal(check([ing('2 handfuls walnuts', 'walnuts', 60, { guess: true })], 1)[0].kind, 'vague');
  assert.equal(check([ing('1 handful walnuts', 'walnuts', 30)], 1)[0].kind, 'vague');
  assert.deepEqual(check([ing('1 handful spinach', 'spinach', 30, { guess: true })], 1), []);
  assert.deepEqual(check([ing('60 g walnuts', 'walnuts', 60)], 1), []);
});

test('frying oil is noted, not fixed', () => {
  const w = check([ing('200 ml oil for frying', 'oil', 180), ing('400 g potatoes', 'potato', 400)], 4);
  assert.equal(w[0].kind, 'frying');
  assert.equal(w[0].fix, null);
  assert.equal(w[0].dir, 'over');
  assert.deepEqual(check([ing('1 tbsp oil', 'oil', 14), ing('400 g potatoes', 'potato', 400)], 4), []);
});

test('unmatched calorie-dense ingredient: total too low', () => {
  const w = check([ing('100 g butter', null, null, { conf: null }), ing('300 g pasta', 'pasta', 300)], 2);
  assert.equal(w[0].kind, 'unmatched');
  assert.equal(w[0].dir, 'under');
  assert.equal(w[0].kcal, Math.round(717 / 2));
  assert.deepEqual(check([ing('1 pinch salt', null, null, { conf: null })], 2), []);
  assert.deepEqual(check([ing('parsley to taste', null, 0, { toTaste: true, conf: null })], 2), []);
});

test('threshold: small issues hidden; >= 80 kcal per serving passes; ranking and max 3', () => {
  const small = [ing('20 g cooked pasta', 'pasta', 20), ing('1000 g potato', 'potato', 1000), ing('1000 g beef mince', 'beef-ground', 1000), ing('500 g butter', 'butter', 500)];
  assert.ok(!kinds(check(small, 8)).includes('cooked'));
  const many = [ing('1000 g olive oil', 'olive-oil', 1000, { conf: 'user' }), ing('300 g cooked rice', 'rice', 300)];
  assert.ok(check(many, 4).some((x) => x.kind === 'cooked'));
  const lots = [
    ing('100 g cooked rice', 'rice', 100), ing('300 g cooked pasta', 'pasta', 300), ing('500 g cooked lentils', 'lentils', 500),
    ing('400 g cooked buckwheat', 'buckwheat', 400), ing('50 g butter', null, null, { conf: null }),
  ];
  const r = check(lots, 2);
  assert.equal(r.length, 3);
  assert.deepEqual(r.map((x) => x.kcal), [...r.map((x) => x.kcal)].sort((a, b) => b - a));
  assert.equal(checkRecipe(lots, 2, foods, { max: 1 }).length, 1);
});

test('ignoring a warning stops that kind for that ingredient only', () => {
  const ings = [ing('300 g cooked rice', 'rice', 300), ing('300 g cooked pasta', 'pasta', 300)];
  const w = check([ignoreWarning(ings[0], 'cooked'), ings[1]]);
  assert.deepEqual(w.map((x) => x.i), [1]);
});

test('sample library: known problems are caught', () => {
  const lib = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'library-sample.json'), 'utf8')).recipes;
  const run = (id) => { const r = lib.find((x) => x.id === id); const own = libToOwn(r, foods); return { own, w: checkRecipe(own.ingredients, own.servings, foods) }; };
  const coq = run('sample-stew');
  assert.ok(coq.w.length >= 1 && coq.w.length <= 3);
  assert.ok(coq.w.some((x) => /leg|thigh/i.test(x.name)), 'stew: chicken legs/thighs flagged');
  let rec = coq.own;
  for (const w of coq.w) if (w.fix) rec = { ...rec, ingredients: rec.ingredients.map((g, j) => (j === w.i ? applyFix(g, w.fix, foods) : g)) };
  assert.notEqual(recipeTotals(rec.ingredients).kcal, coq.own.totals.kcal);
  assert.ok(!checkRecipe(rec.ingredients, rec.servings, foods).some((x) => x.kind === 'cut'));
  for (const r of lib) assert.ok(run(r.id).w.length <= 3);
});
