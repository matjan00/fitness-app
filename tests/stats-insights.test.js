import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  weightDays, lossRate, goalDate, nutritionDays, proteinSummary, maintenanceWeeks, strengthKept, setsPerMuscle, recentPRs,
  habits, runWeeks, trainingLoad, weekVsLast, weekStory, localDay,
} from '../docs/stats-insights.js';
import { addDays, dayList } from '../docs/stats-calc.js';

const losing = (end, n, from = 90, perDay = 0.1) => dayList(end, n).map((day, i) => ({ day, kg: Math.round((from - i * perDay) * 100) / 100 }));

test('weight days keep gaps and carry the trend', () => {
  const rows = weightDays([{ day: '2026-10-01', kg: 80 }, { day: '2026-10-05', kg: 79 }], '2026-10-05', 5);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((r) => r.kg), [80, null, null, null, 79]);
  assert.equal(rows[2].trend, 80);
});

test('rate of loss in kg and % per week, and the goal date', () => {
  const w = losing('2026-10-28', 35, 90, 0.1);
  const r = lossRate(w, '2026-10-28');
  assert.ok(r.kg4 < -0.55 && r.kg4 > -0.75, `kg4 ${r.kg4}`);
  assert.ok(r.pct < -0.6 && r.pct > -0.9, `pct ${r.pct}`);
  assert.equal(lossRate(w.slice(-10), '2026-10-28').kg2, null); // under two weeks of history
  assert.equal(goalDate(84, -0.7, 80, '2026-10-28'), addDays('2026-10-28', Math.ceil((4 / 0.7) * 7)));
  assert.equal(goalDate(84, 0.2, 80, '2026-10-28'), null); // gaining while aiming lower
});

test('nutrition from day facts, protein summary, maintenance by week', () => {
  const facts = { '2026-10-26': { kcal: 2000, p: 150 }, '2026-10-27': { kcal: 2200, p: 130 } };
  const rows = nutritionDays('2026-10-28', 3, (d) => facts[d]);
  assert.deepEqual(rows.map((r) => r.logged), [true, true, false]);
  assert.deepEqual(proteinSummary(rows, 140, 80), { avg: 140, perKg: 1.8, hit: 1, days: 2 });
  const m = maintenanceWeeks(['2026-10-26'], rows, () => ({ tdee: 2600 }), '2026-10-28');
  assert.deepEqual(m, [{ week: '2026-10-26', intake: 2100, tdee: 2600 }]);
});

test('strength kept: e1RM change per lift, bodyweight lifts use body weight, local days', () => {
  const W = (day, ex) => ({ id: day, started_at: `${day}T10:00:00`, ended_at: `${day}T11:00:00`, exercises: ex });
  const bench = (kg) => ({ exercise_id: 'bench', sets: [{ kg: 20, reps: 10, type: 'w' }, { kg, reps: 5 }] });
  const pull = (reps) => ({ exercise_id: 'pullup', mode: 'bw', sets: [{ reps }] });
  const ws = [W('2026-10-01', [bench(80), pull(8)]), W('2026-10-08', [bench(82.5), pull(9)]), W('2026-10-15', [bench(76)])];
  const s = strengthKept(ws, '2026-09-01', () => 80);
  const b = s.find((x) => x.id === 'bench');
  assert.equal(b.sessions.length, 3);
  assert.ok(b.change < -4 && b.change > -6, `bench change ${b.change}`);
  assert.ok(s.find((x) => x.id === 'pullup').change > 0);
  // same reps while getting lighter: pull-ups hold steady instead of "losing strength"
  const light = strengthKept([W('2026-10-01', [pull(8)]), W('2026-10-08', [pull(8)])], '2026-09-01', (d) => (d === '2026-10-01' ? 85 : 80));
  assert.equal(light[0].change, 0);
  // every exercise, even one done once, when asked for
  const all = strengthKept([...ws, W('2026-10-20', [{ exercise_id: 'curl', mode: 'wr', sets: [{ kg: 15, reps: 10 }] }])], '2026-09-01', () => 80, Infinity, 1);
  assert.ok(all.find((x) => x.id === 'curl'));
  assert.equal(strengthKept(ws, '2026-09-01', () => 80).find((x) => x.id === 'curl'), undefined);
  assert.equal(localDay('2026-10-14T00:30:00'), '2026-10-14');
});

test('sets per muscle per week, recent PRs', () => {
  const ws = [
    { id: 'a', started_at: '2026-10-20T10:00:00', exercises: [{ exercise_id: 'bench', sets: [{ type: 'w' }, {}, {}, {}] }] },
    { id: 'b', started_at: '2026-10-22T10:00:00', exercises: [{ exercise_id: 'bench', sets: [{}, {}, {}] }, { exercise_id: 'row', sets: [{}, {}] }] },
  ];
  const groups = { bench: ['Chest', 'Triceps'], row: ['Back'] };
  const m = setsPerMuscle(ws, (id) => groups[id], '2026-10-20', '2026-10-26');
  assert.deepEqual(m.find((x) => x.group === 'Chest'), { group: 'Chest', sets: 6 });
  const prs = new Map([['b', [{ exercise_id: 'bench', kind: 'kg', value: 85, prev: 82.5 }, { exercise_id: 'bench', kind: 'e1rm', value: 99, prev: 96 }]]]);
  assert.deepEqual(recentPRs(ws, prs, '2026-10-01'), [{ day: '2026-10-22', exercise_id: 'bench', kind: 'e1rm', value: 99, prev: 96, n: 1 }]);
  const more = new Map([['a', [{ exercise_id: 'bench', kind: 'e1rm', value: 97, prev: 96 }]], ['b', [{ exercise_id: 'bench', kind: 'e1rm', value: 99, prev: 97 }]]]);
  assert.deepEqual(recentPRs(ws, more, '2026-10-01'), [{ day: '2026-10-22', exercise_id: 'bench', kind: 'e1rm', value: 99, prev: 96, n: 2 }]);
});

test('habits, running weeks with easy pace, training load', () => {
  const facts = { '2026-10-27': { steps: 12000, sleep: 7.5 }, '2026-10-28': { steps: 8000 } };
  assert.deepEqual(habits('2026-10-28', 3, (d) => facts[d]), { steps: 10000, stepDays: 2, stepsHit: 1, sleep: 7.5, sleepDays: 1, sleep7: 1 });
  const runs = [
    { start: '2026-10-27T07:00:00', distance_m: 5000, moving_s: 1800 }, // 6:00/km easy
    { start: '2026-10-25T07:00:00', distance_m: 5000, moving_s: 1500 },
    { start: '2026-10-31T07:00:00', distance_m: 14000, moving_s: 5600 }, // long run, not in the pace
  ];
  const r = runWeeks(runs, ['2026-10-26']);
  assert.deepEqual(r, [{ week: '2026-10-26', km: 19, min: 123, runs: 2, pace: 360 }]);
  const ws = [0, 7, 14, 21, 28].map((n) => ({ started_at: `${addDays('2026-10-28', -n)}T10:00:00`, ended_at: `${addDays('2026-10-28', -n)}T11:00:00` }));
  assert.deepEqual(trainingLoad(ws, [], '2026-10-28'), { last7: 60, usual: 60, ratio: 1 });
});

test('this week vs last week and the weekly story', () => {
  const rows = nutritionDays('2026-10-28', 10, (d) => ({ kcal: d >= '2026-10-26' ? 2000 : 2300, p: 150 }));
  const w = weekVsLast('2026-10-28', { rows, weights: losing('2026-10-28', 20, 85, 0.1), training: () => ({ lift: 2, run: 1, goal: { lift: 3, run: 2 } }) });
  assert.equal(w.now.kcal, 2000);
  assert.equal(w.prev.kcal, 2300);
  assert.equal(w.delta.kcal, -300);
  assert.ok(w.now.trend < 0);
  const s = weekStory({ week: w.now, deficit: 652, proteinHit: 3, proteinDays: 3, lift: { name: 'Bench', change: 1 } });
  assert.match(s, /^Trend −0\.\d kg · deficit ~650 kcal\/day · protein 3\/3 days · gym 2\/3 · runs 1\/2 · Bench \+1%$/);
});
