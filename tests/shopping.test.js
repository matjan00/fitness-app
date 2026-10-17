import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildList, recipeLines, entryLines, eatenServings, aisleOf, gramsText, listText, keepTicks, dayRange } from '../docs/shopping.js';

const chicken = { src: 'db', id: 'chicken-breast', en: 'Chicken breast', pl: 'Pierś z kurczaka' };
const rice = { src: 'db', id: 'rice', en: 'Rice' };
const rec = { id: 'r1', title: 'Chicken rice', servings: 2, ingredients: [
  { head: true, name: 'Sauce' },
  { name: 'pierś kurczaka', food: chicken, grams: 400 },
  { name: 'ryż', food: rice, grams: 200 },
  { name: 'sól', toTaste: true },
] };
const lib = { id: 'L1', title: 'Lib', servings: 4, ingredients: [{ name: 'chicken', food_id: 'chicken-breast', grams: 800 }, { name: 'parsley', grams: null }] };
const lookup = (s) => ({ r1: rec, L1: lib })[s.id] || null;
const item = (l, k) => l.items.find((i) => i.key === k);

test('recipe lines scale by servings and skip headings', () => {
  const l = recipeLines(rec, 1.5);
  assert.equal(l.length, 3);
  assert.equal(l[0].grams, 600);
  assert.equal(l[0].key, 'db:chicken-breast');
  assert.equal(l[2].grams, null);
});

test('chosen recipe: servings default to recipe servings, else scaled', () => {
  assert.equal(item(buildList({ recipes: [{ rec, servings: 2 }] }), 'db:chicken-breast').grams, 400);
  assert.equal(item(buildList({ recipes: [{ rec, servings: 4 }] }), 'db:chicken-breast').grams, 800);
  assert.equal(item(buildList({ recipes: [{ rec, servings: 0 }] }), 'db:chicken-breast').grams, 400);
});

test('same food id aggregates across recipes, library ids and plain entries', () => {
  const entries = [{ label: 'Chicken', source: { type: 'food' }, food: chicken, grams: 150 }];
  const l = buildList({ recipes: [{ rec, servings: 2 }, { rec: lib, servings: 4 }], entries });
  assert.equal(item(l, 'db:chicken-breast').grams, 400 + 800 + 150);
  assert.equal(item(l, 'db:chicken-breast').n, 3);
});

test('same normalised name aggregates when no food matched', () => {
  const a = { ingredients: [{ name: 'Śmietana', grams: 100 }] };
  const b = { ingredients: [{ name: 'smietana ', grams: 50 }] };
  const l = buildList({ recipes: [{ rec: a, servings: 1 }, { rec: b, servings: 1 }] });
  assert.equal(l.items.length, 1);
  assert.equal(l.items[0].grams, 150);
});

test('items without weight stay on the list as partial', () => {
  const l = buildList({ recipes: [{ rec: lib, servings: 4 }] });
  const p = l.items.find((i) => i.name === 'Parsley');
  assert.equal(p.partial, true);
  assert.equal(p.grams, 0);
  assert.match(listText(l.items), /\[ \] Parsley$/m);
});

test('diary recipe entry expands by servings eaten', () => {
  const e = { label: 'Chicken rice', source: { type: 'recipe', id: 'r1' }, servings: 1, grams: null };
  const r = entryLines(e, lookup);
  assert.equal(r.lines.find((x) => x.key === 'db:rice').grams, 100);
});

test('diary recipe entry logged in grams uses per-serving grams', () => {
  const e = { label: 'Lib', source: { type: 'library', id: 'L1' }, servings: null, grams: 100, per: { grams: 200 } };
  assert.equal(eatenServings(e), 0.5);
  assert.equal(entryLines(e, lookup).lines[0].grams, 100);
});

test('entry logged from a scaled recipe shops for the scaled amount', () => {
  assert.equal(eatenServings({ servings: 2, scale: 1.5 }), 3);
  assert.equal(eatenServings({ servings: null, grams: 300, per: { grams: 300 }, scale: 2 }), 2);
});

test('entries that cannot be expanded are reported', () => {
  const l = buildList({ entries: [
    { label: 'Quick', source: { type: 'quick' }, kcal: 200 },
    { label: 'Gone', source: { type: 'recipe', id: 'zzz' }, servings: 1 },
    { label: 'Mystery', source: { type: 'food' }, grams: 0 },
    { label: 'Oats', source: { type: 'food' }, food: { src: 'db', id: 'oats', en: 'Oats' }, grams: 60 },
  ], lookup });
  assert.equal(l.items.length, 1);
  assert.deepEqual(l.skipped.map((s) => s.label), ['Quick', 'Gone', 'Mystery']);
});

test('aisles, sorting and text', () => {
  assert.equal(aisleOf('Pierś z kurczaka'), 'meat');
  assert.equal(aisleOf('Mleko 2%'), 'dairy');
  assert.equal(aisleOf('Pomidory'), 'produce');
  assert.equal(aisleOf('Olej rzepakowy'), 'pantry');
  assert.equal(aisleOf('xyz'), 'other');
  assert.equal(gramsText(1250), '1.25 kg');
  assert.equal(gramsText(80.4), '80 g');
  const l = buildList({ recipes: [{ rec, servings: 2 }] });
  const t = listText(l.items.map((i) => (i.key === 'db:rice' ? { ...i, done: true } : i)));
  assert.match(t, /Meat & fish\n\[ \] Chicken breast — 400 g/);
  assert.doesNotMatch(t, /Rice/);
  assert.match(listText(l.items.map((i) => ({ ...i, done: true })), { all: true }), /\[x\] Rice — 200 g/);
});

test('ticks survive a rebuild; day range', () => {
  const l = buildList({ recipes: [{ rec, servings: 2 }] });
  const old = l.items.map((i) => ({ ...i, done: i.key === 'db:rice' }));
  assert.equal(item({ items: keepTicks(l.items, old) }, 'db:rice').done, true);
  assert.equal(item({ items: keepTicks(l.items, old) }, 'db:chicken-breast').done, false);
  assert.deepEqual(dayRange('2026-10-30', 3, (d, n) => `${d}+${n}`), ['2026-10-30+0', '2026-10-30+1', '2026-10-30+2']);
});

test('one row per ingredient even when matched in one recipe and typed in another; shop units', async () => {
  const { buildList: build, amountText, keepTicks: keep } = await import('../docs/shopping.js');
  const onion = { src: 'db', id: 'onion', en: 'Onion', u: { piece: 110 } };
  const milk = { src: 'db', id: 'milk', en: 'Milk 2%', liquid: true };
  const a = { servings: 1, ingredients: [{ name: 'cebula', food: onion, grams: 220 }, { name: 'mleko', food: milk, grams: 250 }] };
  const b = { servings: 1, ingredients: [{ name: 'Onion', grams: null }] };
  const l = build({ recipes: [{ rec: a, servings: 1 }, { rec: b, servings: 1 }] });
  const rows = l.items.filter((i) => /onion/i.test(i.name));
  assert.equal(rows.length, 1);
  assert.equal(amountText(rows[0]), '2 (≈ 220 g) +');
  assert.equal(amountText(l.items.find((i) => i.name === 'Milk 2%')), '250 ml');
  const ticked = l.items.map((i) => ({ ...i, done: i.name === 'Milk 2%' }));
  assert.equal(keep(l.items, ticked).find((i) => i.name === 'Milk 2%').done, true);
});
