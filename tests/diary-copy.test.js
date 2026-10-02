import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copiedEntries, movedEntry, dayChoices, copyMessage } from '../docs/diary-copy.js';

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
