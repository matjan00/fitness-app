import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groceryList, amountText, listText } from '../docs/grocery-calc.js';

const plans = [
  { day: '2026-11-02', lines: [
    { key: 'p11:1', name: 'Płatki owsiane', unit: 'g', qty: 80, g: 80, recipe: 'Owsianka' },
    { key: 'p12:5', name: 'Banan', unit: 'sztuka', qty: 0.5, g: 60, recipe: 'Owsianka' },
    { key: 'p7:3', name: 'Skyr', unit: 'kubek', qty: 1, g: 150, recipe: null },
  ] },
  { day: '2026-11-03', lines: [
    { key: 'p11:1', name: 'Płatki owsiane', unit: 'g', qty: 80, g: 80, recipe: 'Owsianka' },
    { key: 'p12:1', name: 'Banan', unit: 'g', qty: 100, g: 100, recipe: null },
    { key: 'xKebab:2', name: 'Kebab', unit: 'porcja', qty: 1, g: null, recipe: null },
  ] },
  { day: '2026-11-04', lines: [{ key: 'p99:1', name: 'Ryż', unit: 'g', qty: 200, g: 200 }] },
];

test('adds up the chosen days only, one row per product', () => {
  const rows = groceryList(plans, ['2026-11-02', '2026-11-03']);
  assert.deepEqual(rows.map((r) => r.name), ['Banan', 'Kebab', 'Płatki owsiane', 'Skyr']);
  const oats = rows.find((r) => r.key === 'p11');
  assert.deepEqual(oats.parts, [{ unit: 'g', qty: 160 }]);
  assert.deepEqual(oats.days, ['2026-11-02', '2026-11-03']);
  assert.deepEqual(oats.recipes, ['Owsianka']);
  const banana = rows.find((r) => r.key === 'p12');
  assert.equal(banana.g, 160);
  assert.equal(amountText(banana), '0.5 sztuka + 100 g (≈ 160 g)');
});

test('amounts', () => {
  assert.equal(amountText({ parts: [{ unit: 'g', qty: 1250 }], g: 1250 }), '1.25 kg');
  assert.equal(amountText({ parts: [{ unit: 'ml', qty: 500 }], g: 500 }), '500 ml');
  assert.equal(amountText({ parts: [{ unit: 'kubek', qty: 2 }], g: 300 }), '2 kubek (≈ 300 g)');
  assert.equal(amountText({ parts: [{ unit: 'porcja', qty: 1 }], g: null }), '1 porcja');
});

test('a row without a weight keeps its count but drops the gram total', () => {
  const rows = groceryList([{ day: 'd', lines: [{ key: 'p1:2', name: 'Egg', unit: 'piece', qty: 2, g: null }, { key: 'p1:1', name: 'Egg', unit: 'g', qty: 50, g: 50 }] }], ['d']);
  assert.equal(rows[0].g, null);
  assert.equal(amountText(rows[0]), '2 piece + 50 g');
});

test('junk is skipped and nothing chosen gives an empty list', () => {
  assert.deepEqual(groceryList([null, { day: '2026-11-02', lines: 'x' }], ['2026-11-02']), []);
  assert.deepEqual(groceryList(plans, []), []);
});

test('text for sharing leaves out ticked rows', () => {
  const rows = groceryList(plans, ['2026-11-04', '2026-11-02']);
  assert.equal(listText(rows, { p12: true }), '- Płatki owsiane: 80 g\n- Ryż: 200 g\n- Skyr: 1 kubek (≈ 150 g)');
});
