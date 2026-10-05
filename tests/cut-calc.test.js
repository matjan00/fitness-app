import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PLAN, ROUTINES, MAIN_LIFTS, routineRecords, weekNumber, startWeightFrom, targetWeight, planWeeks,
  projectedWeight, daysToGoal, emaTrend, trendOn, targetsChanged,
} from '../docs/cut-calc.js';

const exercises = JSON.parse(readFileSync(new URL('../docs/data/exercises.json', import.meta.url), 'utf8'));
const ids = new Set(exercises.map((e) => e.id));

test('every plan exercise and swap exists in the exercise library', () => {
  for (const r of ROUTINES) for (const x of r.exercises) {
    assert.ok(ids.has(x.exercise_id), x.exercise_id);
    if (x.alt) assert.ok(ids.has(x.alt), x.alt);
  }
  for (const id of MAIN_LIFTS) assert.ok(ids.has(id), id);
});

test('routines match Part 1 (A/B/C, sets × reps, rest)', () => {
  assert.deepEqual(ROUTINES.map((r) => r.name), ['Upper A', 'Upper B', 'Upper C']);
  assert.deepEqual(ROUTINES[0].exercises.map((x) => `${x.sets}x${x.reps}`), ['4x6-10', '4x8-10', '3x12-15', '3x10-12', '3x12-20']);
  assert.equal(ROUTINES[2].exercises.length, 6);
  const recs = routineRecords(5);
  assert.equal(recs[1].order, 6);
  assert.equal(recs[0].program, 'Cut 11 weeks');
  assert.deepEqual(recs[0].exercises[0], { exercise_id: 'Leverage_Chest_Press', sets: 4, reps: '6-10', kg: null, rest: 150 });
});

test('plan has 11 weeks + 2 buffer, deloads in 5 and 10, checkpoints in 4 and 8', () => {
  assert.equal(PLAN.length, 13);
  assert.deepEqual(PLAN.filter((w) => w.deload).map((w) => w.week), [5, 10]);
  assert.deepEqual(PLAN.filter((w) => w.checkpoint).map((w) => w.week), [4, 8]);
  assert.deepEqual(PLAN.filter((w) => w.buffer).map((w) => w.week), [12, 13]);
});

test('target trend weights from 73 kg match the Part 1 table', () => {
  const w = planWeeks({ startDate: '2026-10-12' }, 73);
  assert.deepEqual(w.slice(0, 11).map((x) => x.target), [72.3, 71.5, 70.8, 70, 69.3, 68.5, 67.8, 67, 66.3, 65.5, 65]);
  assert.equal(w[11].target, null);
  assert.equal(w[0].from, '2026-10-12');
  assert.equal(w[0].to, '2026-10-18');
  assert.equal(w[10].to, '2026-12-27');
  assert.equal(targetWeight(null, 65, 0.75, 1), null);
});

test('changing the start date re-dates the whole plan', () => {
  const a = planWeeks({ startDate: '2026-10-12' }, 73);
  const b = planWeeks({ startDate: '2026-10-19' }, 73);
  assert.equal(b[0].from, '2026-10-19');
  assert.equal(b[12].from, '2027-01-11');
  assert.notEqual(a[12].from, b[12].from);
  assert.equal(planWeeks({}, 73)[0].from, null);
});

test('weekNumber', () => {
  assert.equal(weekNumber('2026-10-12', '2026-10-11'), 0);
  assert.equal(weekNumber('2026-10-12', '2026-10-12'), 1);
  assert.equal(weekNumber('2026-10-12', '2026-10-18'), 1);
  assert.equal(weekNumber('2026-10-12', '2026-10-19'), 2);
  assert.equal(weekNumber(null, '2026-10-19'), 0);
});

test('start weight: manual value, else average of the first 3 weigh-ins from the start', () => {
  const e = [{ day: '2026-10-10', kg: 80 }, { day: '2026-10-14', kg: 72.6 }, { day: '2026-10-12', kg: 73.4 }, { day: '2026-10-13', kg: 73 }, { day: '2026-10-15', kg: 60 }];
  assert.equal(startWeightFrom(e, '2026-10-12'), 73);
  assert.equal(startWeightFrom(e, '2026-10-12', 74), 74);
  assert.equal(startWeightFrom(e, '2026-10-20'), null);
  assert.equal(startWeightFrom(e, null), null);
  assert.equal(startWeightFrom([{ day: '2026-10-12', kg: 73.5 }], '2026-10-12'), 73.5);
});

test('projected weight flattens at the goal; days to goal', () => {
  const cfg = { startDate: '2026-10-12', goalWeight: 65, rate: 0.75 };
  assert.equal(projectedWeight(cfg, 73, '2026-10-12'), 73);
  assert.equal(projectedWeight(cfg, 73, '2026-10-19'), 72.25);
  assert.equal(projectedWeight(cfg, 73, '2027-03-01'), 65);
  assert.equal(projectedWeight(cfg, 73, '2026-10-01'), 73);
  assert.equal(projectedWeight({}, 73, '2026-10-19'), null);
  assert.equal(daysToGoal('2026-10-12', '2026-10-12'), 76);
  assert.equal(daysToGoal('2026-10-12', '2027-01-30'), 0);
});

test('EMA trend (α = 0.1) in day order, ignoring bad rows', () => {
  const t = emaTrend([{ day: '2026-10-02', kg: 72 }, { day: '2026-10-01', kg: 73 }, { day: 'x', kg: 70 }, { day: '2026-10-03', kg: 0 }, null]);
  assert.deepEqual(t, [{ day: '2026-10-01', kg: 73, trend: 73 }, { day: '2026-10-02', kg: 72, trend: 72.9 }]);
  assert.equal(trendOn(t, '2026-09-30'), null);
  assert.equal(trendOn(t, '2026-10-01'), 73);
  assert.equal(trendOn(t, '2026-10-05'), 72.9);
});

test('targetsChanged compares kcal, macros and steps', () => {
  assert.equal(targetsChanged({ kcal: 1750, p: 150, steps: 10000 }, { kcal: 1750, p: 150, steps: 10000 }), false);
  assert.equal(targetsChanged({ kcal: 1750 }, { kcal: 1650 }), true);
  assert.equal(targetsChanged({ steps: 10000 }, { steps: 12000 }), true);
  assert.equal(targetsChanged(null, { kcal: 1 }), true);
});
