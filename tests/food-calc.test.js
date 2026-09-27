import { test } from 'node:test';
import assert from 'node:assert/strict';
import { macrosFor, recipeTotals, perServing, sumEntries, bmr, suggestTargets, weightTrend, weeklyChange, latestWeight, ingredientStatus } from '../docs/food-calc.js';
import { suggestCategories } from '../docs/food-cats.js';

const chicken = { k: 120, p: 22.5, c: 0, f: 2.6 };
const rice = { k: 365, p: 7.1, c: 80, f: 0.7 };

test('macros per grams', () => {
  assert.deepEqual(macrosFor(chicken, 200), { kcal: 240, p: 45, c: 0, f: 5.2 });
  assert.deepEqual(macrosFor(chicken, 0), { kcal: 0, p: 0, c: 0, f: 0 });
  assert.deepEqual(macrosFor(null, 100), { kcal: 0, p: 0, c: 0, f: 0 });
});

test('recipe totals skip unmatched rows and count them', () => {
  const t = recipeTotals([
    { name: 'kurczak', food: chicken, grams: 200 },
    { name: 'ryż', food: rice, grams: 100 },
    { name: 'coś', food: null, grams: null },
    { name: 'Sos', head: true },
    { name: 'sól', toTaste: true, food: null },
    { name: 'pieczarki', food: chicken, grams: null },
  ]);
  assert.equal(Math.round(t.kcal), 605);
  assert.equal(t.grams, 300);
  assert.equal(t.missing, 2);
  const s = perServing(t, 2);
  assert.equal(Math.round(s.kcal), 303);
  assert.equal(s.grams, 150);
  assert.equal(ingredientStatus({ food: chicken, grams: '' }), 'nograms');
});

test('daily sums', () => {
  const s = sumEntries([{ kcal: 100, p: 10, c: 5, f: 1 }, { kcal: 50, p: 1, c: 2, f: 3 }]);
  assert.deepEqual(s, { kcal: 150, p: 11, c: 7, f: 4 });
});

test('Mifflin-St Jeor BMR and targets', () => {
  assert.equal(bmr({ sex: 'male', age: 30, height: 180, weight: 80 }), 1780);
  assert.equal(bmr({ sex: 'female', age: 30, height: 165, weight: 60 }), 1320.25);
  const t = suggestTargets({ sex: 'male', age: 30, height: 180, weight: 80, activity: 'moderate', goal: 'maintain' });
  assert.equal(t.tdee, 2759);
  assert.equal(t.kcal, 2760);
  assert.equal(t.protein, 144);
  const lose = suggestTargets({ sex: 'male', age: 30, height: 180, weight: 80, activity: 'moderate', goal: 'lose', rate: 0.5 });
  assert.equal(lose.kcal, 2210);
  assert.ok(Math.abs(lose.protein * 4 + lose.fat * 9 + lose.carbs * 4 - lose.kcal) < 15);
  assert.equal(suggestTargets({ sex: 'male' }), null);
});

test('weight trend and weekly change', () => {
  const e = [];
  for (let i = 0; i < 15; i++) e.push({ day: `2026-09-${String(i + 1).padStart(2, '0')}`, kg: 80 - i * 0.1 });
  const tr = weightTrend(e.slice().reverse());
  assert.equal(tr[0].day, '2026-09-01');
  assert.equal(tr[0].avg, 80);
  assert.ok(Math.abs(tr[14].avg - (80 - 1.1)) < 1e-9);
  assert.ok(Math.abs(weeklyChange(e) - -0.7) < 1e-9);
  assert.equal(weeklyChange([{ day: '2026-09-01', kg: 80 }]), null);
  assert.equal(latestWeight(e).kg, 80 - 1.4);
});

test('category suggestions (Polish + English)', () => {
  const a = suggestCategories({ title: 'Makaron z kurczakiem z jednej patelni', ingredients: ['200 g makaronu', '300 g piersi z kurczaka', '2 jajka'], steps: ['Podsmaż kurczaka na patelni.'] });
  assert.deepEqual(a.main.sort(), ['chicken', 'pasta']);
  assert.ok(a.technique.includes('pan'));
  assert.ok(a.technique.includes('onepot'));
  assert.deepEqual(a.meal, ['lunch']);
  const b = suggestCategories({ title: 'Owsianka proteinowa', ingredients: ['50 g płatków owsianych', '200 ml mleka'], steps: ['Ugotuj płatki na mleku.'] });
  assert.deepEqual(b.meal, ['breakfast']);
  assert.ok(b.main.includes('oats'));
  assert.ok(b.technique.includes('boiled'));
  const c = suggestCategories({ title: 'Sernik bez pieczenia', ingredients: ['500 g twarogu', '100 g cukru'], steps: [] });
  assert.ok(c.meal.includes('dessert'));
  assert.ok(c.technique.includes('nocook'));
  assert.ok(c.main.includes('twarog'));
  const d = suggestCategories({ title: 'Air fryer salmon', ingredients: ['2 salmon fillets'], steps: ['Cook in the air fryer at 200°C for 10 minutes.'] });
  assert.ok(d.technique.includes('airfryer'));
  assert.ok(d.main.includes('fish'));
  const e = suggestCategories({ title: 'Breakfast burrito', ingredients: ['1 tortilla', '3 eggs'], steps: [] });
  assert.deepEqual(e.meal, ['breakfast']);
});
