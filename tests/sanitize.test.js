import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanItem, cleanWorkout, cleanRoutine, cleanMeal, cleanRun, cleanBodyweight, cleanRecipe, cleanFood } from '../docs/sanitize.js';
import { workoutVolume, workoutSetCount, bestSet, computePRs, lastSessions, recentUse } from '../docs/gym-calc.js';
import { dailyNutrition, weightSeries, runWeekly, gymWeekly } from '../docs/stats-calc.js';

const junk = [null, undefined, 0, 'x', 7, [], true];

test('every cleaner rejects non-objects', () => {
  for (const kind of ['workout', 'routine', 'meal', 'run', 'bodyweight', 'recipe', 'library', 'food', 'other']) {
    for (const j of junk) assert.equal(cleanItem(kind, j), null, `${kind} ${String(j)}`);
  }
});

test('cleanWorkout: needs a date; exercises/sets always arrays; junk entries dropped', () => {
  assert.equal(cleanWorkout({ exercises: [] }), null);
  assert.equal(cleanWorkout({ started_at: 'nope' }), null);
  const w = cleanWorkout({ started_at: '2026-01-02T10:00:00Z', ended_at: 'bad', exercises: [null, 5, { exercise_id: 'a', mode: 'zz', sets: 'oops' }, { exercise_id: 'b', sets: [null, { kg: {}, reps: '8', type: 'q', secs: 'x' }, { kg: 60, reps: 5, done: true }] }] });
  assert.equal(w.ended_at, null);
  assert.equal(w.exercises.length, 2);
  assert.deepEqual(w.exercises[0].sets, []);
  assert.equal(w.exercises[0].mode, 'wr');
  assert.equal(w.exercises[1].sets.length, 2);
  assert.deepEqual([w.exercises[1].sets[0].kg, w.exercises[1].sets[0].type, w.exercises[1].sets[0].secs], ['', 'n', 0]);
  assert.equal(w.exercises[1].sets[1].kg, '60');
  assert.equal(cleanWorkout({ started_at: '2026-01-02', exercises: null }).exercises.length, 0);
});

test('cleanRoutine: defaults for name/order/exercise fields', () => {
  const r = cleanRoutine({ name: 5, order: 'x', exercises: [null, { sets: 'a' }, { exercise_id: 'e', sets: 'a', reps: {}, kg: 'z', rest: null }] });
  assert.equal(r.name, '5');
  assert.equal(r.order, 0);
  assert.equal(r.exercises.length, 1);
  assert.deepEqual(r.exercises[0], { exercise_id: 'e', sets: 1, reps: '', kg: null, rest: 90 });
  assert.deepEqual(cleanRoutine({ exercises: 'x' }).exercises, []);
});

test('cleanMeal / cleanBodyweight / cleanRun', () => {
  assert.equal(cleanMeal({ day: 'x' }), null);
  assert.equal(cleanMeal({ kcal: 5 }), null);
  const m = cleanMeal({ day: '2026-03-01', kcal: 'abc', p: '12', c: null, f: undefined, food: 'x', source: [] });
  assert.deepEqual([m.kcal, m.p, m.c, m.f, m.food, m.source], [0, 12, 0, 0, null, null]);
  assert.equal(cleanBodyweight({ day: '2026-03-01', kg: 'abc' }), null);
  assert.equal(cleanBodyweight({ day: '2026-03-01', kg: '80.5' }).kg, 80.5);
  assert.equal(cleanRun({ start: 'bad', distance_m: 5 }), null);
  assert.equal(cleanRun({ start: '2026-03-01T08:00:00Z', distance_m: 'x' }).distance_m, 0);
});

test('cleanRecipe / cleanFood', () => {
  const r = cleanRecipe({ title: null, ingredients: ['2 eggs', null, { name: 'milk' }, 4], steps: [1, 'mix'], servings: 'x', cats: 'bad', notes: 3 });
  assert.equal(r.title, 'Untitled recipe');
  assert.deepEqual(r.ingredients, [{ name: '2 eggs', raw: '2 eggs' }, { name: 'milk' }]);
  assert.deepEqual(r.steps, ['mix']);
  assert.equal(r.servings, 1);
  assert.equal('cats' in r, false);
  assert.equal(r.notes, '3');
  assert.deepEqual(cleanRecipe({ ingredients: null, steps: 'x' }).ingredients, []);
  assert.equal(cleanFood({ name: '  ' }), null);
  assert.equal(cleanFood({ name: 'Oats', kcal: 'x' }).kcal, 0);
});

test('calc functions survive malformed workouts / inputs', () => {
  const bad = [null, { exercises: 5 }, { exercises: [null, { sets: 'x' }, { sets: [null, { kg: 'a' }] }] }, { started_at: 'zz', exercises: null }];
  for (const w of bad) { workoutVolume(w); workoutSetCount(w); }
  assert.equal(bestSet({ sets: 'x' }), null);
  assert.equal(bestSet(null), null);
  computePRs(bad); lastSessions(bad); recentUse(bad);
  assert.equal(computePRs(null).size, 0);
});

test('stats-calc survives malformed inputs', () => {
  const d = dailyNutrition([null, 5, { day: '2026-03-02', kcal: 'x', p: null }, { day: {} }], '2026-03-02', 3);
  assert.equal(d[2].kcal, 0);
  assert.equal(d[2].logged, true);
  assert.equal(dailyNutrition(null, '2026-03-02', 2).length, 2);
  const ws = weightSeries([null, { day: '2026-03-01', kg: '70' }, { day: '2026-03-02', kg: 72 }, { day: 5, kg: 1 }, { day: '2026-03-02', kg: 'z' }], '2026-03-02', 5);
  assert.deepEqual(ws.map((x) => x.kg), [70, 72]);
  assert.equal(ws[1].avg, 71);
  assert.deepEqual(weightSeries('x', '2026-03-02', 5), []);
  assert.equal(runWeekly([null, { start: 'bad', distance_m: 5000 }, { start: '2026-03-02T08:00:00Z', distance_m: '5000' }, 4], '2026-03-02', 4).reduce((a, r) => a + r.km, 0), 5);
  assert.equal(runWeekly(null, '2026-03-02', 4).length, 4);
  const g = gymWeekly([null, { started_at: 'bad' }, { started_at: '2026-03-02T08:00:00Z', exercises: 3 }], '2026-03-02', 4, workoutVolume);
  assert.equal(g.reduce((a, r) => a + r.sessions, 0), 1);
  assert.equal(gymWeekly(undefined, '2026-03-02', 4).length, 4);
});

test('cut plan kinds: daily, checkin, targets', async () => {
  const { cleanDaily, cleanCheckin, cleanTargets } = await import('../docs/sanitize.js');
  assert.equal(cleanDaily({ day: 'bad' }), null);
  assert.deepEqual(cleanDaily({ day: '2026-10-12', steps: '9500', sleepHours: '', kcal: null, minimum: 'yes', extra: 1 }),
    { day: '2026-10-12', steps: 9500, sleepHours: null, kcal: null, p: null, c: null, f: null, minimum: false, travel: false, note: '', extra: 1 });
  const c = cleanCheckin({ day: '2026-10-18', waist: '84.5', photos: 'x' });
  assert.equal(c.waist, 84.5);
  assert.equal(c.hips, null);
  assert.deepEqual(c.photos, {});
  assert.equal(c.reflection, '');
  assert.equal(cleanTargets({ day: '2026-10-12', kcal: '1750', steps: 10000 }).kcal, 1750);
  assert.equal(cleanItem('daily', null), null);
});
