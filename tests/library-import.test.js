import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeLibrary, loadLibrary } from '../docs/food-library.js';
import { loadIndex, normalizeLine, convertIngredient } from '../scripts/library/convert.mjs';
import { uuid5, recordId, sourceIdOf, isSeafood, isFish, excluded, usablePublished, chooseNutrition, jsonLdToRaw, buildRecipe } from '../scripts/library/import-lib.mjs';

const ctx = loadIndex();

test('seafood filter: shellfish out, sauces and regular fish kept, fish optional', () => {
  for (const t of ['Garlic shrimp pasta', '12 large prawns', 'Mussels in white wine', '200 g crab meat', 'Grilled scallops', 'Squid ring salad', 'Lobster roll', 'clams', 'oysters on ice', 'calamari', 'octopus', 'crayfish tails']) assert.ok(isSeafood(t), t);
  for (const t of ['2 tbsp oyster sauce', '1 tbsp fish sauce', 'shrimp paste', '3 scallions', 'salmon fillet', 'chicken curry']) assert.ok(!isSeafood(t), t);
  assert.ok(isFish('2 salmon fillets') && isFish('smoked haddock') && !isFish('oyster sauce') && !isFish('fish sauce'));
  const salmon = { title: 'Baked salmon', ingredients: ['2 salmon fillets', 'lemon'] };
  assert.equal(excluded(salmon, ['seafood']), null);
  assert.equal(excluded(salmon, ['seafood', 'fish']), 'fish');
  assert.equal(excluded({ title: 'Paella', ingredients: ['200 g prawns', 'rice'] }, ['seafood']), 'seafood');
  assert.equal(excluded({ title: 'Stew', ingredients: ['beef'], category: 'Seafood' }, ['seafood']), 'seafood');
  assert.equal(excluded({ title: 'Beef stew', ingredients: ['beef', '1 tbsp oyster sauce'] }, ['seafood']), null);
});

test('ids: uuid5 matches Python and is deterministic per user/source/page', () => {
  // expected value from Python: uuid.uuid5(NAMESPACE, 'u1:library:bbcgoodfood:recipes/chicken-stroganoff')
  assert.equal(recordId('u1', 'bbcgoodfood', 'recipes/chicken-stroganoff'), 'a6e77648-ae4f-5d1e-ba40-f71dc5e8d118');
  assert.equal(uuid5('6f2f5a3e-6a1a-4a55-9c2e-6d0d6a1a3b10', 'u1:library:bbcgoodfood:recipes/chicken-stroganoff'), 'a6e77648-ae4f-5d1e-ba40-f71dc5e8d118');
  assert.equal(recordId('u1', 'x', 'y'), recordId('u1', 'x', 'y'));
  assert.notEqual(recordId('u1', 'x', 'y'), recordId('u2', 'x', 'y'));
  assert.notEqual(recordId('u1', 'x', 'y'), recordId('u1', 'z', 'y'));
  assert.equal(sourceIdOf('https://www.skinnytaste.com/Baked-Chicken/?utm=1'), 'baked-chicken');
});

test('published nutrition wins when complete and plausible; computed is kept beside it', () => {
  assert.equal(usablePublished(null), null);
  assert.equal(usablePublished({ kcal: 400, protein: 30, carbs: null, fat: 10 }), null);
  assert.equal(usablePublished({ kcal: 5, protein: 1, carbs: 1, fat: 0 }), null);
  assert.deepEqual(usablePublished({ kcal: 425.4, protein: 43, carbs: 20, fat: 12 }), { kcal: 425, p: 43, c: 20, f: 12 });
  const rec = { per_serving: { kcal: 500, p: 20, c: 50, f: 20 } };
  const a = chooseNutrition(rec, { kcal: 425, protein: 43, carbs: 20, fat: 12 });
  assert.equal(a.nutrition_basis, 'published');
  assert.deepEqual(a.per_serving, { kcal: 425, p: 43, c: 20, f: 12 });
  assert.deepEqual(a.computed_per_serving, { kcal: 500, p: 20, c: 50, f: 20 });
  const b = chooseNutrition(rec, { kcal: 425, protein: 43 });
  assert.equal(b.nutrition_basis, 'computed');
  assert.deepEqual(b.per_serving, rec.per_serving);
});

const LD = { '@context': 'https://schema.org', '@type': 'Recipe', name: 'Test chicken rice', image: ['https://img.example/a.jpg'],
  recipeIngredient: ['300 g chicken breast', '150 g rice', 'one 14-ounce can chickpeas', '2 garlic cloves crushed'],
  recipeInstructions: [{ '@type': 'HowToStep', text: 'Cook it. Bake at 400F.' }, { '@type': 'HowToStep', text: 'Serve.' }],
  prepTime: 'PT10M', cookTime: 'PT25M', video: { embedUrl: 'https://youtu.be/x' },
  nutrition: { calories: '410 kcal', proteinContent: '38 g', carbohydrateContent: '30 g', fatContent: '12 g' } };
const HTML = `<html><script type="application/ld+json">${JSON.stringify(LD)}</script></html>`;
test('schema.org page -> library recipe: published nutrition, image, video, servings estimated from published kcal', () => {
  const raw = jsonLdToRaw(HTML, 'https://s.example/r', 'skinnytaste');
  assert.equal(raw.prep_min, 10);
  assert.equal(raw.cook_min, 25);
  assert.equal(raw.video, 'https://youtu.be/x');
  assert.equal(raw.source.license, 'personal use — see source site');
  assert.match(raw.steps[0], /205°C/);
  raw.id = 'skinnytaste:r';
  const rec = buildRecipe(raw, ctx);
  assert.equal(rec.nutrition_basis, 'published');
  assert.equal(rec.per_serving.kcal, 410);
  assert.ok(rec.computed_per_serving.kcal > 0);
  assert.ok(rec.est.servings, 'servings were not stated');
  assert.equal(rec.image, 'https://img.example/a.jpg');
  assert.equal(jsonLdToRaw('<html>nothing</html>', 'https://s.example/r', 'skinnytaste'), null);
});

test('ingredient oddities: word numbers, container weights, adjectives before the unit, per-item weights', () => {
  assert.equal(normalizeLine('one 14-ounce can chickpeas, drained'), '14 ounce chickpeas, drained');
  assert.equal(normalizeLine('4 garlic cloves crushed'), '4 cloves garlic crushed');
  assert.equal(normalizeLine('3 finely chopped Garlic Clove'), '3 Clove finely chopped Garlic');
  assert.equal(normalizeLine('4 boneless, skinless chicken breasts (about 8 oz each, 1 1/2 lbs)'), '32 oz chicken breasts');
  const g = (l) => convertIngredient(l, ctx.index).row;
  assert.equal(g('4 garlic cloves crushed').grams, 12);
  assert.ok(Math.abs(g('one 14-ounce can chickpeas').grams - 396.9) < 1);
  assert.equal(g('Olive oil cooking spray').grams, 0);
  assert.equal(g('natural yogurt to serve').grams, 0);
  assert.equal(g('224 g (~1/2 lb) orzo').food_id, 'pasta');
});

test('loader merges private records with static data, dedupes, skips broken records', async () => {
  const mk = (id, extra = {}) => ({ id, title: id, ingredients: [{ text: 'x' }], steps: ['s'], per_serving: { kcal: 1, p: 1, c: 1, f: 1 }, source: { type: 'x' }, ...extra });
  const merged = mergeLibrary([mk('static-1'), mk('u-2', { key: 'a:b' })], [mk('u-1', { key: 'a:b' }), mk('u-2'), { id: 'broken' }]);
  assert.deepEqual(merged.map((r) => r.id), ['u-1', 'u-2', 'static-1']);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false });
  try {
    const lib = await loadLibrary([mk('u-1')], 'nowhere/');
    assert.deepEqual(lib.recipes.map((r) => r.id), ['u-1']);
    assert.deepEqual((await loadLibrary([], 'nowhere/')).recipes, []);
  } finally { globalThis.fetch = oldFetch; }
});

test('pruning: only stale rows of the sources in this run, and never after a failed source', async () => {
  const { pruneIds, canPrune } = await import('../scripts/library/import-lib.mjs');
  const rows = [
    { id: 'a', data: { key: 'mealdb:1' } }, { id: 'b', data: { key: 'mealdb:2' } },
    { id: 'c', data: { key: 'bbcgoodfood:recipes/x' } }, { id: 'd', data: {} }, { id: 'e', data: { key: 'mealdb:3' } },
  ];
  const keep = new Set(['mealdb:1', 'mealdb:3']);
  assert.deepEqual(pruneIds(rows, keep, new Set(['mealdb'])), ['b']); // other sources and keyless rows untouched
  assert.deepEqual(pruneIds(rows, keep, new Set(['mealdb', 'bbcgoodfood'])), ['b', 'c']);
  const ok = { tried: 5, ok: 4, seafood: 1, fish: 0 };
  assert.ok(canPrune({ mealdb: ok }, false));
  assert.ok(!canPrune({ mealdb: ok }, true)); // a list could not be read
  assert.ok(!canPrune({ mealdb: ok, x: { tried: 3, ok: 0, seafood: 0, fish: 0 } }, false)); // one source failed entirely
  assert.ok(!canPrune({}, false));
});
