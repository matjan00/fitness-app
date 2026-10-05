import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeOf, weekSummary, suggestions, liftChange, lastCheckinDay } from '../docs/cut-week.js';
import { addDays } from '../docs/stats-calc.js';

const days = (from, n) => Array.from({ length: n }, (_, i) => addDays(from, i));

test('grade thresholds', () => {
  assert.equal(gradeOf(0.95), 'A');
  assert.equal(gradeOf(0.8), 'B');
  assert.equal(gradeOf(0.75), 'C');
  assert.equal(gradeOf(0.6), 'D');
  assert.equal(gradeOf(0.55), 'E');
  assert.equal(gradeOf(0.49), 'F');
});

test('week summary and grade', () => {
  const cfg = { startDate: '2026-10-12', checkinDay: 0 };
  const statusOf = (d) => ({
    status: d === '2026-10-24' ? 'red' : 'green',
    facts: { kcal: 1750, p: 150, steps: 10000, sleep: 7 },
    session: { kind: ['2026-10-19', '2026-10-21', '2026-10-23'].includes(d) ? 'lift' : 'rest' },
    done: d !== '2026-10-23',
  });
  const weights = days('2026-10-12', 14).map((d, i) => ({ day: d, kg: 73 - i * 0.1 }));
  const workouts = [{ started_at: '2026-10-19T10:00:00', ended_at: '2026-10-19T11:00:00', cut: { session: 'progressed' } },
    { started_at: '2026-10-21T10:00:00', ended_at: '2026-10-21T11:00:00', cut: { session: 'held' } }];
  const s = weekSummary('2026-10-26', { statusOf, weights, workouts, cfg, start: 73 });
  assert.equal(s.from, '2026-10-19');
  assert.equal(s.to, '2026-10-25');
  assert.equal(s.green, 6);
  assert.equal(s.sessionsDone, 2);
  assert.equal(s.sessionsPlanned, 3);
  assert.equal(s.strength, 0.9);
  assert.equal(s.week, 2);
  assert.equal(s.target, 71.5);
  assert.ok(s.change < 0);
  // (6/7 + 2/3 + 1 + 0.9) / 4 ≈ 0.856 → B
  assert.equal(s.grade, 'B');
  assert.equal(weekSummary('2026-10-26', { statusOf, weights, workouts, cfg, start: 73, checkinDone: false }).grade, 'D'); // ≈ 0.606
});

test('adjustment rules', () => {
  const flat = days('2026-10-01', 20).map((d) => ({ day: d, kg: 73 }));
  const base = { weights: flat, checkinDay: '2026-10-20', week: 3, targets: { kcal: 1750, steps: 10000 } };
  assert.equal(suggestions({ ...base, compliance: 0.9 })[0].key, 'kcal');
  assert.deepEqual(suggestions({ ...base, compliance: 0.9 })[0].change, { kcal: 1650 });
  assert.equal(suggestions({ ...base, compliance: 0.7 })[0].key, 'compliance');
  assert.equal(suggestions({ ...base, compliance: 0.7 })[0].change, undefined);
  assert.deepEqual(suggestions({ ...base, compliance: 0.9, targets: { kcal: 1650, steps: 10000 } })[0].change, { steps: 12000 });
  const fast = days('2026-10-01', 20).map((d, i) => ({ day: d, kg: 80 - i * 0.4 }));
  const f = suggestions({ ...base, weights: fast, compliance: 0.9 });
  assert.equal(f[0].key, 'fast');
  assert.deepEqual(f[0].change, { kcal: 1900 });
  assert.equal(suggestions({ ...base, weights: fast, week: 2, compliance: 0.9 })[0].key, 'ok');
  assert.equal(suggestions({ ...base, weights: [], compliance: 1 })[0].key, 'data');
  const more = suggestions({ ...base, compliance: 0.9, liftDrop: 6, sleep: 6 }).map((x) => x.key);
  assert.deepEqual(more, ['kcal', 'lifts', 'sleep']);
});

test('lift change over 2 weeks and the check-in day', () => {
  const W = (day, kg) => ({ started_at: `${day}T10:00:00`, ended_at: `${day}T11:00:00`, exercises: [{ exercise_id: 'Standing_Military_Press', sets: [{ type: 'n', kg, reps: 8 }] }] });
  assert.equal(liftChange([W('2026-10-01', 40), W('2026-10-15', 37.5)], '2026-10-20'), 6.3);
  assert.equal(liftChange([W('2026-10-15', 37.5)], '2026-10-20'), null);
  assert.equal(lastCheckinDay('2026-10-20', 0), '2026-10-18');
  assert.equal(lastCheckinDay('2026-10-18', 0), '2026-10-18');
});

test('progress chart data', async () => {
  const { weightChart, liftSeries } = await import('../docs/cut-week.js');
  const rows = weightChart([{ day: '2026-10-12', kg: 73 }, { day: '2026-10-13', kg: 72 }], { startDate: '2026-10-12' }, 73, '2026-10-14');
  assert.equal(rows[0].day, '2026-10-05');
  assert.equal(rows.length, 7 + 91);
  assert.equal(rows[7].kg, 73);
  assert.equal(rows[8].trend, 72.9);
  assert.equal(rows[9].trend, 72.9); // carried on to today
  assert.equal(rows[10].trend, null); // future
  assert.equal(rows[14].projected, 72.25);
  assert.equal(rows[rows.length - 1].projected, 65);
  assert.equal(rows[0].projected, null);
  const S = (kg, ...r) => r.map((x) => ({ type: 'n', kg, reps: x }));
  const ws = [{ started_at: '2026-10-12T10:00:00', ended_at: '2026-10-12T11:00:00', exercises: [{ exercise_id: 'Leverage_Chest_Press', mode: 'wr', sets: S(60, 10) }, { exercise_id: 'Pullups', mode: 'bw', sets: S(0, 8) }] },
    { started_at: '2026-10-14T10:00:00', ended_at: '2026-10-14T11:00:00', exercises: [{ exercise_id: 'Wide-Grip_Lat_Pulldown', mode: 'wr', sets: S(50, 10) }] }];
  const ls = liftSeries(ws, '2026-10-01');
  assert.deepEqual(ls['Chest press'], [{ day: '2026-10-12', e1rm: 80 }]);
  assert.equal(ls['Pull-up / pulldown'].length, 1);
});
