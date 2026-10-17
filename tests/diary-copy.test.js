import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copiedEntries, movedEntry, dayChoices, copyMessage, copyTarget, deleteMessage } from '../docs/diary-copy.js';

const e = (id, meal, t, extra = {}) => ({ id, day: '2026-10-01', meal, t, label: id, source: { type: 'food', id: 'x' }, grams: 150, kcal: 200, p: 10, c: 20, f: 5, ...extra });
const now = new Date('2026-10-02T10:00:00Z');

test('copies get no id, new day, same amounts and macros', () => {
  const src = [e('a', 'lunch', '2026-10-01T12:00:00Z'), e('b', 'lunch', '2026-10-01T12:05:00Z', { source: { type: 'recipe', id: 'r' }, servings: 2, grams: null })];
  const out = copiedEntries(src, { day: '2026-10-03', now });
  assert.equal(out.length, 2);
  for (const [i, c] of out.entries()) {
    assert.equal('id' in c, false);
    assert.equal(c.day, '2026-10-03');
    assert.equal(c.meal, 'lunch');
    for (const k of ['label', 'source', 'grams', 'servings', 'kcal', 'p', 'c', 'f']) assert.deepEqual(c[k], src[i][k]);
  }
  assert.equal(src[0].day, '2026-10-01'); // original untouched
  assert.ok(out[0].t < out[1].t);
});

test('target meal overrides; without it each entry keeps its meal', () => {
  const src = [e('a', 'breakfast', '1'), e('b', 'dinner', '2')];
  assert.deepEqual(copiedEntries(src, { day: 'd', meal: 'snack', now }).map((c) => c.meal), ['snack', 'snack']);
  assert.deepEqual(copiedEntries(src, { day: 'd', now }).map((c) => c.meal), ['breakfast', 'dinner']);
});

test('empty input gives nothing', () => assert.deepEqual(copiedEntries([], { day: 'd', now }), []));

test('movedEntry keeps the id and changes only the meal', () => {
  const m = movedEntry(e('a', 'lunch', '1'), 'dinner');
  assert.equal(m.id, 'a'); assert.equal(m.meal, 'dinner'); assert.equal(m.kcal, 200);
  assert.equal(movedEntry(e('a', 'lunch', '1'), 'lunch'), null);
  assert.equal(movedEntry(e('a', 'lunch', '1'), 'brunch'), null);
});

test('dayChoices and message', () => {
  const add = (s, n) => `${s}+${n}`;
  assert.deepEqual(dayChoices('T', add).map((c) => [c.label, c.day]), [['Yesterday', 'T+-1'], ['Today', 'T'], ['Tomorrow', 'T+1']]);
  assert.equal(copyMessage(1, { mealName: 'Lunch', dayName: 'Tomorrow' }), 'Copied 1 item to Lunch · Tomorrow');
  assert.equal(copyMessage(3, { dayName: 'Today' }), 'Copied 3 items · Today');
});

test('copyTarget allows the same day / meal, rejects bad input', () => {
  assert.deepEqual(copyTarget('2026-10-01', 'dinner'), { day: '2026-10-01', meal: 'dinner' });
  assert.equal(copyTarget('', 'lunch'), null);
  assert.equal(copyTarget(null, 'lunch'), null);
  assert.equal(copyTarget('2026-10-01', 'brunch'), null);
});

test('deleteMessage names the meal and counts items', () => {
  assert.equal(deleteMessage(3, 'Lunch'), 'Deleted lunch · 3 items');
  assert.equal(deleteMessage(1, 'Breakfast'), 'Deleted breakfast · 1 item');
  assert.equal(deleteMessage(2), 'Deleted 2 items');
});

test('a meal becomes a one-serving recipe draft', async () => {
  const { mealRecipeDraft } = await import('../docs/diary-copy.js');
  const { recipeTotals } = await import('../docs/food-calc.js');
  const oats = { src: 'db', id: 'oats', name: 'Oats', k: 380, p: 13, c: 60, f: 7 };
  const eggFood = { src: 'db', id: 'egg', name: 'Egg', k: 140, p: 12, c: 1, f: 10 };
  const own = { id: 'r1', servings: 2, ingredients: [{ name: 'Rice', grams: 200, qty: 200, unit: 'g', food: { k: 130, p: 3, c: 28, f: 0 } }, { head: true, name: 'Sauce' }] };
  const entries = [
    { t: '3', label: 'Bowl', source: { type: 'recipe', id: 'r1' }, servings: 1, kcal: 130 },
    { t: '1', label: 'Oats', source: { type: 'food' }, food: oats, grams: 50, kcal: 190, p: 6.5, c: 30, f: 3.5 },
    { t: '2', label: 'Egg', source: { type: 'food' }, food: eggFood, grams: 120, qty: 2, unit: 'piece', kcal: 168 },
    { t: '4', label: 'Bar', source: { type: 'quick' }, kcal: 200, p: 20, c: 15, f: 5 },
  ];
  const d = mealRecipeDraft(entries, { lookup: (id) => (id === 'r1' ? own : undefined) });
  assert.equal(d.servings, 1);
  assert.deepEqual(d.ingredients.map((g) => [g.name, g.grams]), [['Oats', 50], ['Egg', 120], ['Rice', 100], ['Bar', 100]]);
  assert.equal(d.ingredients[1].raw, '2 piece Egg');
  assert.equal(Math.round(recipeTotals(d.ingredients).kcal), 190 + 168 + 130 + 200);
});
