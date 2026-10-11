import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factorForKcal, scaleIngredients, roundGrams, clampFactor, factorLabel } from '../docs/food-scale.js';
import { recipeTotals } from '../docs/food-calc.js';

const rice = { k: 365, p: 7.1, c: 80, f: 0.7 };
const egg = { k: 143, p: 12.6, c: 0.7, f: 9.5 };

test('factorForKcal', () => {
  assert.equal(factorForKcal(600, 400), 1.5);
  assert.equal(factorForKcal(300, 600), 0.5);
  assert.equal(factorForKcal(100, 300), 0.33);
  assert.equal(factorForKcal(0, 400), null);
  assert.equal(factorForKcal(500, 0), null);
  assert.equal(factorForKcal('x', 400), null);
  assert.equal(factorForKcal(100000, 100), 10); // clamped
});

test('roundGrams is kitchen friendly', () => {
  assert.equal(roundGrams(3.2), 3);
  assert.equal(roundGrams(0.2), 0.5);
  assert.equal(roundGrams(47.6), 48);
  assert.equal(roundGrams(183), 185);
  assert.equal(roundGrams(0), 0);
});

test('clampFactor / factorLabel', () => {
  assert.equal(clampFactor('abc'), 1);
  assert.equal(clampFactor(-2), 1);
  assert.equal(clampFactor(50), 10);
  assert.equal(clampFactor(0.01), 0.1);
  assert.equal(factorLabel(1.5), '×1.5');
});

test('scaleIngredients scales grams, units and keeps the rest', () => {
  const ings = [
    { head: true, name: 'Sauce' },
    { raw: '200 g ryżu', qty: 200, unit: 'g', name: 'ryżu', food: rice, grams: 200 },
    { raw: '2 jajka', qty: 2, unit: 'piece', name: 'jajka', food: egg, grams: 110 },
    { raw: 'sól do smaku', qty: null, unit: null, name: 'sól', food: null, grams: 0, toTaste: true },
    { raw: 'bazylia', name: 'bazylia', food: null, grams: null },
  ];
  const out = scaleIngredients(ings, 1.5);
  assert.equal(out[0].head, true);
  assert.equal(out[1].grams, 300);
  assert.equal(out[1].raw, '300 g ryżu');
  assert.equal(out[2].grams, 165);
  assert.equal(out[2].qty, 3);
  assert.equal(out[2].unit, 'piece');
  assert.equal(out[2].raw, '3 pc jajka');
  assert.equal(out[3].grams, 0);
  assert.equal(out[4].grams, null);
  assert.equal(ings[1].grams, 200); // input untouched
});

test('scaled recipe lands near the target kcal', () => {
  const ings = [{ raw: '200 g ryżu', qty: 200, unit: 'g', name: 'ryżu', food: rice, grams: 200 }, { raw: '3 jajka', qty: 3, unit: 'piece', name: 'jajka', food: egg, grams: 165 }];
  const base = recipeTotals(ings).kcal;
  const f = factorForKcal(500, base / 2);
  const scaled = recipeTotals(scaleIngredients(ings, f)).kcal / 2;
  assert.ok(Math.abs(scaled - 500) < 25, `got ${scaled}`);
  assert.deepEqual(scaleIngredients(ings, 1), ings);
});
