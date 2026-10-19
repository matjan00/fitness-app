import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sumEntries, foodEntries, bmr, suggestTargets, weightTrend, weeklyChange, latestWeight } from '../docs/food-calc.js';

test('daily sums', () => {
  const s = sumEntries([{ kcal: 100, p: 10, c: 5, f: 1 }, { kcal: 50, p: 1, c: 2, f: 3 }]);
  assert.deepEqual(s, { kcal: 150, p: 11, c: 7, f: 4 });
});

test('Fitatu day totals replace the old diary for that day only', () => {
  const fitatu = [{ id: 'x', day: '2026-10-18', kcal: 2100, p: 160, c: 210, f: 65, items: 12 }];
  const meals = [
    { day: '2026-10-18', meal: 'lunch', kcal: 900, p: 50, c: 80, f: 30 },
    { day: '2026-10-10', meal: 'lunch', kcal: 700, p: 40, c: 60, f: 20 },
    { day: '2026-10-10', meal: 'dinner', kcal: 500, p: 30, c: 40, f: 15 },
  ];
  const e = foodEntries(fitatu, meals);
  assert.deepEqual(sumEntries(e.filter((x) => x.day === '2026-10-18')), { kcal: 2100, p: 160, c: 210, f: 65 });
  assert.deepEqual(sumEntries(e.filter((x) => x.day === '2026-10-10')), { kcal: 1200, p: 70, c: 100, f: 35 });
  assert.equal(e.length, 3);
  assert.deepEqual(foodEntries(), []);
  assert.deepEqual(foodEntries([null, { kcal: 5 }], [null]), []);
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
