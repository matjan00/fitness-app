import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adaptiveTdee, missedLifts, rescheduleLifts, redFlags, isLogged } from '../docs/cut-flags.js';
import { addDays } from '../docs/stats-calc.js';

const W = (day, name, extra = {}) => ({ name, started_at: `${day}T10:00:00`, ended_at: `${day}T11:00:00`, exercises: [], ...extra });
const days = (from, n) => Array.from({ length: n }, (_, i) => addDays(from, i));

test('adaptive TDEE from 21 days of calories and the trend change', () => {
  const d = days('2026-10-01', 21);
  const weights = d.map((x, i) => ({ day: x, kg: 73 - i * 0.1 }));
  const r = adaptiveTdee('2026-10-21', { weights, kcalOf: () => 1750 });
  assert.equal(r.avgKcal, 1750);
  assert.equal(r.days, 21);
  assert.ok(r.change < 0);
  assert.equal(r.tdee, Math.round(1750 - (r.change * 7700) / 21));
  assert.equal(adaptiveTdee('2026-10-21', { weights, kcalOf: (x) => (x > '2026-10-10' ? 1750 : null) }), null); // < 14 days
  assert.equal(adaptiveTdee('2026-10-21', { weights: [], kcalOf: () => 1750 }), null);
});

test('missed lifts and the next free day (never two lifts in a row)', () => {
  // week of Mon 2026-10-12: A done Mon, Wed missed; today is Thu
  const workouts = [W('2026-10-12', 'Upper A')];
  assert.deepEqual(missedLifts('2026-10-15', { workouts }), ['2026-10-14']);
  assert.deepEqual(missedLifts('2026-10-15', { workouts, startDate: '2026-10-15' }), []);
  // Wed missed, today Thu (Wed had no lift) → Upper B today, the next lift moves from Fri to Sat
  assert.deepEqual(rescheduleLifts('2026-10-15', { workouts }), { day: '2026-10-15', then: '2026-10-17' });
  // lifted yesterday (B done late on Thu) → not today; Sat, then Mon
  assert.deepEqual(rescheduleLifts('2026-10-16', { workouts: [W('2026-10-12', 'Upper A'), W('2026-10-15', 'Upper B')] }), null);
  assert.deepEqual(rescheduleLifts('2026-10-16', { workouts: [W('2026-10-15', 'Upper B')] }), { day: '2026-10-17', then: '2026-10-19' });
  assert.equal(rescheduleLifts('2026-10-15', { workouts: [W('2026-10-12', 'Upper A'), W('2026-10-14', 'Upper B')] }), null);
});

test('logged day', () => {
  assert.equal(isLogged('2026-10-12', { weights: [{ day: '2026-10-12', kg: 73 }], dailies: [], meals: [] }), true);
  assert.equal(isLogged('2026-10-12', { weights: [], dailies: [{ day: '2026-10-12', minimum: true }], meals: [] }), false);
});

const base = (over = {}) => ({ weights: [], dailies: [], meals: [], workouts: [], runs: [], checkins: [], ...over });

test('red flags: protein, weigh-ins, missed sessions, minimum days, sleep', () => {
  const cfg = { startDate: '2026-10-12', checkinDay: 0 };
  // Thursday 15th: Mon/Tue/Wed sessions missed, nothing logged
  const f = redFlags('2026-10-15', base(), cfg, 73).map((x) => x.key);
  assert.ok(f.includes('missed'));
  assert.ok(f.includes('protein'));
  assert.ok(f.includes('weighin'));
  const good = base({
    weights: days('2026-10-12', 4).map((d) => ({ day: d, kg: 73 })),
    dailies: days('2026-10-12', 3).map((d) => ({ day: d, p: 150, sleepHours: 7.5 })),
    workouts: [W('2026-10-12', 'Upper A'), W('2026-10-14', 'Upper B')],
    runs: [{ start: '2026-10-13T07:00:00', distance_m: 5000 }],
  });
  assert.deepEqual(redFlags('2026-10-15', good, cfg, 73), []);
  assert.deepEqual(redFlags('2026-10-11', base(), cfg, 73), []); // before the start
  const mins = base({ ...good, dailies: [...good.dailies.slice(0, 1), { day: '2026-10-13', p: 150, minimum: true }, { day: '2026-10-14', p: 150, minimum: true }] });
  assert.ok(redFlags('2026-10-15', mins, cfg, 73).some((x) => x.key === 'minimum'));
  const sleepy = base({ ...good, weights: days('2026-10-12', 8).map((d) => ({ day: d, kg: 73 })), dailies: days('2026-10-12', 7).map((d) => ({ day: d, p: 150, sleepHours: 6 })) });
  assert.ok(redFlags('2026-10-19', sleepy, cfg, 73).some((x) => x.key === 'sleep'));
});

test('red flags: check-in skipped, behind the checkpoint, strength down', () => {
  const cfg = { startDate: '2026-10-12', checkinDay: 0 };
  const weights = days('2026-10-12', 9).map((d) => ({ day: d, kg: 73 }));
  const f = redFlags('2026-10-20', base({ weights }), cfg, 73).map((x) => x.key);
  assert.ok(f.includes('checkin'));
  assert.ok(!f.includes('behind')); // 73 vs 72.3 target: 0.7 kg behind
  assert.ok(redFlags('2026-10-20', base({ weights: weights.map((w) => ({ ...w, kg: 74 })) }), cfg, 74.5).every((x) => x.key !== 'behind'));
  assert.ok(redFlags('2026-10-20', base({ weights: weights.map((w) => ({ ...w, kg: 74 })) }), cfg, 73).some((x) => x.key === 'behind'));
  assert.ok(!redFlags('2026-10-20', base({ weights, checkins: [{ day: '2026-10-18' }] }), cfg, 73).some((x) => x.key === 'checkin'));
  const S = (kg, ...r) => r.map((x) => ({ type: 'n', kg, reps: x }));
  const press = (day, kg) => W(day, 'Upper A', { exercises: [{ exercise_id: 'Leverage_Chest_Press', sets: S(kg, 8, 8) }] });
  const st = redFlags('2026-10-20', base({ weights, workouts: [press('2026-10-12', 60), press('2026-10-19', 52.5)] }), cfg, 73);
  assert.ok(st.some((x) => x.key === 'strength'));
  const dropped = [W('2026-10-14', 'Upper B', { cut: { session: 'dropped' } }), W('2026-10-16', 'Upper C', { cut: { session: 'dropped' } })];
  assert.ok(redFlags('2026-10-20', base({ weights, workouts: dropped }), cfg, 73).some((x) => x.key === 'strength'));
});

test('travel days are not held against you', () => {
  const cfg = { startDate: '2026-10-12', checkinDay: 0 };
  const dailies = ['2026-10-12', '2026-10-13', '2026-10-14'].map((d) => ({ day: d, travel: true }));
  const weights = ['2026-10-12', '2026-10-13', '2026-10-14'].map((d) => ({ day: d, kg: 73 }));
  const f = redFlags('2026-10-15', { weights, dailies, meals: [], workouts: [], runs: [], checkins: [] }, cfg, 73).map((x) => x.key);
  assert.ok(!f.includes('missed'));
  assert.ok(!f.includes('protein'));
  assert.equal(rescheduleLifts('2026-10-15', { travel: new Set(dailies.map((d) => d.day)) }), null);
});
