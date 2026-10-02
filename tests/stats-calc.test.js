import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayList, weekOf, weekList, weeksFor, dailyNutrition, weeklyNutrition, averageLogged, weightSeries, runWeekly, gymWeekly } from '../docs/stats-calc.js';

test('dayList / weekOf / weekList', () => {
  assert.deepEqual(dayList('2026-03-02', 3), ['2026-02-28', '2026-03-01', '2026-03-02']);
  assert.equal(weekOf('2026-10-02'), '2026-09-28'); // Friday → Monday
  assert.equal(weekOf('2026-09-28'), '2026-09-28');
  assert.equal(weekOf('2026-10-04'), '2026-09-28'); // Sunday
  assert.deepEqual(weekList('2026-10-02', 2), ['2026-09-21', '2026-09-28']);
  assert.equal(weeksFor(7), 4);
  assert.equal(weeksFor(365), 53);
});

test('dailyNutrition sums entries and flags logged days', () => {
  const rows = dailyNutrition([
    { day: '2026-10-01', kcal: 500, p: 30, c: 50, f: 10 },
    { day: '2026-10-01', kcal: 300, p: 10, c: 40, f: 5 },
    { day: '2026-09-01', kcal: 999 }, // out of range
    { day: '2026-10-02', kcal: 'x' },
  ], '2026-10-02', 3);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { day: '2026-09-30', kcal: 0, p: 0, c: 0, f: 0, logged: false });
  assert.equal(rows[1].kcal, 800);
  assert.equal(rows[1].p, 40);
  assert.equal(rows[2].logged, true);
  assert.equal(rows[2].kcal, 0);
});

test('weeklyNutrition averages only logged days; averageLogged handles empty', () => {
  const daily = dailyNutrition([
    { day: '2026-09-28', kcal: 2000, p: 100, c: 200, f: 60 },
    { day: '2026-09-29', kcal: 3000, p: 200, c: 300, f: 80 },
  ], '2026-10-04', 7);
  const w = weeklyNutrition(daily);
  assert.equal(w.length, 1);
  assert.equal(w[0].kcal, 2500);
  assert.equal(w[0].p, 150);
  assert.equal(averageLogged(daily).days, 2);
  assert.equal(averageLogged(dailyNutrition([], '2026-10-04', 7)), null);
  assert.equal(weeklyNutrition(dailyNutrition([], '2026-10-04', 7))[0].logged, false);
});

test('weightSeries filters to range but averages over earlier entries', () => {
  const s = weightSeries([
    { day: '2026-09-29', kg: 80 }, { day: '2026-10-01', kg: 82 }, { day: '2026-08-01', kg: 90 }, { day: '2026-10-02', kg: 0 },
  ], '2026-10-02', 7);
  assert.deepEqual(s.map((e) => e.day), ['2026-09-29', '2026-10-01']);
  assert.equal(s[1].avg, 81);
  assert.deepEqual(weightSeries([], '2026-10-02', 7), []);
});

test('runWeekly and gymWeekly bucket by week', () => {
  const r = runWeekly([
    { start: '2026-10-01T10:00:00', distance_m: 5000 },
    { start: '2026-09-30T10:00:00', distance_m: 3000 },
    { start: '2026-09-20T10:00:00', distance_m: 10000 },
    { start: '2026-09-30T10:00:00', distance_m: 0 },
  ], '2026-10-02', 2);
  assert.deepEqual(r.map((x) => [x.week, x.km, x.runs]), [['2026-09-21', 0, 0], ['2026-09-28', 8, 2]]);
  const g = gymWeekly([{ started_at: '2026-10-01T18:00:00', v: 1000 }, { started_at: '2026-10-02T18:00:00', v: 500 }], '2026-10-02', 2, (w) => w.v);
  assert.deepEqual(g.map((x) => [x.sessions, x.volume]), [[0, 0], [2, 1500]]);
  assert.equal(runWeekly(undefined, '2026-10-02', 2).length, 2);
});

test('1-year range collapses to ~53 weekly averages (one point per week, not per day)', () => {
  const daily = dailyNutrition([
    { day: '2026-09-28', kcal: 2000, p: 100, c: 200, f: 60 },
    { day: '2026-09-30', kcal: 2400, p: 140, c: 240, f: 80 },
  ], '2026-10-02', 365);
  const w = weeklyNutrition(daily);
  assert.equal(daily.length, 365);
  assert.ok(w.length >= 53 && w.length <= 54);
  const last = w[w.length - 1];
  assert.equal(last.day, '2026-09-28');
  assert.equal(last.p, 120);
  assert.equal(last.f, 70);
});
