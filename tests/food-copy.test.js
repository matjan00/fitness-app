import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { libToOwn, findCopy, copiesByLib, setIngredient, removeIngredient, amountPatch, withTotals } from '../docs/food-copy.js';
import { recipeTotals, perServing } from '../docs/food-calc.js';
import { dbSnap } from '../docs/food-check.js';

const dir = path.join(import.meta.dirname, '..', 'docs', 'data');
const foods = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(dir, 'foods.json'), 'utf8')).foods.map((f) => [f.id, { ...f, src: 'db' }]));
const lib = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'library-sample.json'), 'utf8')).recipes;

test('every library recipe converts to an own recipe with the same per-serving macros', () => {
  for (const r of lib) {
    const own = libToOwn(r, foods);
    assert.equal(own.from_library, r.id);
    assert.equal(own.servings, r.servings);
    assert.equal(own.ingredients.length, r.ingredients.length);
    const ps = perServing(own.totals, own.servings);
    assert.ok(Math.abs(ps.kcal - r.per_serving.kcal) <= 1, `${r.id}: ${ps.kcal} vs ${r.per_serving.kcal}`);
    assert.ok(Math.abs(ps.p - r.per_serving.p) <= 1);
  }
});

test('copy lookups', () => {
  const a = libToOwn(lib[0], foods);
  const b = { ...libToOwn(lib[1], foods), id: 'x1' };
  assert.equal(findCopy([{ id: 'own' }, b], lib[1].id).id, 'x1');
  assert.equal(findCopy([{ id: 'own' }], lib[1].id), null);
  assert.equal(copiesByLib([a, { id: 'own' }]).get(lib[0].id), a);
});

test('editing an amount and a food updates totals, immutably', () => {
  const own = libToOwn(lib.find((r) => r.id === 'sample-stew'), foods);
  const i = own.ingredients.findIndex((g) => /Chicken Legs/.test(g.raw));
  const before = own.totals.kcal;
  const patch = amountPatch(own.ingredients[i], 300);
  assert.equal(patch.grams, 300);
  const e1 = setIngredient(own, i, patch);
  assert.ok(e1.totals.kcal < before);
  assert.equal(own.totals.kcal, before);
  const e2 = setIngredient(e1, i, { food: dbSnap(foods['chicken-thigh-skin']), conf: 'user' });
  assert.ok(e2.totals.kcal > e1.totals.kcal);
  assert.equal(e2.totals.kcal, recipeTotals(e2.ingredients).kcal);
  const e3 = removeIngredient(e2, i);
  assert.equal(e3.ingredients.length, own.ingredients.length - 1);
  assert.ok(e3.totals.kcal < e2.totals.kcal);
});

test('amountPatch converts portion units to grams and keeps a readable line', () => {
  const ing = { name: 'olive oil' };
  const p = amountPatch(ing, 2, 'tbsp', 13.5, 'tablespoon');
  assert.equal(p.grams, 27);
  assert.equal(p.unit, 'tbsp');
  assert.equal(p.qty, 2);
  assert.equal(p.guess, false);
  assert.match(p.raw, /2 tablespoon olive oil/);
  const g = amountPatch(ing, 150);
  assert.deepEqual([g.grams, g.unit, g.qty, g.raw], [150, 'g', 150, '150 g olive oil']);
  assert.equal(amountPatch(ing, 1, 'serving', 200, 'serving').unit, 'g');
});

test('withTotals is idempotent', () => {
  const own = libToOwn(lib[0], foods);
  assert.deepEqual(withTotals(own).totals, own.totals);
});
