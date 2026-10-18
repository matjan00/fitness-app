import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adaptiveTdee, redFlags, isLogged } from '../docs/cut-flags.js';
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

test('logged day', () => {
  assert.equal(isLogged('2026-10-12', { weights: [{ day: '2026-10-12', kg: 73 }], dailies: [], meals: [] }), true);
  assert.equal(isLogged('2026-10-12', { weights: [], dailies: [{ day: '2026-10-12', minimum: true }], meals: [] }), false);
});

const base = (over = {}) => ({ weights: [], dailies: [], meals: [], workouts: [], runs: [], checkins: [], ...over });

test('red flags: protein, weigh-ins, missed sessions, minimum days, sleep', () => {
  const cfg = { startDate: '2026-10-12', checkinDay: 0 };
  // Thursday 15th: Mon/Tue/Wed sessions missed, nothing logged
  const f = redFlags('2026-10-15', base(), cfg, 73).map((x) => x.key);
  assert.ok(f.includes('missed')); // 5 sessions left, 4 days (Thu–Sun)
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
  assert.ok(!f.includes('checkin')); // Monday's review can still be done until Wednesday
  const w12 = days('2026-10-12', 11).map((d) => ({ day: d, kg: 73 }));
  assert.ok(redFlags('2026-10-22', base({ weights: w12 }), cfg, 73).some((x) => x.key === 'checkin')); // Thursday: skipped
  assert.ok(!redFlags('2026-10-22', base({ weights: w12, checkins: [{ day: '2026-10-18', forDay: '2026-10-19' }] }), cfg, 73).some((x) => x.key === 'checkin'));
  assert.ok(!f.includes('behind')); // 73 vs 72.3 target: 0.7 kg behind
  assert.ok(redFlags('2026-10-20', base({ weights: weights.map((w) => ({ ...w, kg: 74 })) }), cfg, 74.5).every((x) => x.key !== 'behind'));
  assert.ok(redFlags('2026-10-20', base({ weights: weights.map((w) => ({ ...w, kg: 74 })) }), cfg, 73).some((x) => x.key === 'behind'));
  assert.ok(!redFlags('2026-10-22', base({ weights, checkins: [{ day: '2026-10-18' }] }), cfg, 73).some((x) => x.key === 'checkin'));
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
  assert.ok(!f.includes('protein'));
  // the goal stays 3 + 2, so 5 sessions in the 4 days left (Thu–Sun) is behind
  assert.ok(f.includes('missed'));
});

test('red flags: training is judged on the week, not on fixed days', () => {
  const cfg = { startDate: '2026-10-12', checkinDay: 0 };
  const R = (day) => ({ start: `${day}T07:00:00`, distance_m: 5000 });
  const weights = days('2026-10-12', 12).map((d) => ({ day: d, kg: 73 }));
  // Mon–Wed off, Thursday morning: 5 sessions fit in Thu–Sun? No (4 days) → behind
  assert.ok(redFlags('2026-10-15', base({ weights }), cfg, 73).some((x) => x.key === 'missed'));
  // two done on Mon/Tue: 3 left for Thu–Sun → fine, whichever days they were
  const two = base({ weights, workouts: [W('2026-10-13', 'Upper A')], runs: [R('2026-10-12')] });
  assert.ok(!redFlags('2026-10-15', two, cfg, 73).some((x) => x.key === 'missed'));
  // next week: last week ended at 1 gym + 1 run → flagged as short
  const f = redFlags('2026-10-20', two, cfg, 73).find((x) => x.key === 'missed');
  assert.match(f.text, /Last week.*gym 1\/3, runs 1\/2/);
});

test('red flags: a session done today counts, like on the Today card', () => {
  const cfg = { startDate: '2026-10-12', checkinDay: 0 };
  const weights = days('2026-10-12', 12).map((d) => ({ day: d, kg: 73 }));
  // Thursday, gym done this morning: 1/3 gym, 4 to go in Fri–Sun (3 days) → behind, counted with today's session
  const one = base({ weights, workouts: [W('2026-10-15', 'Upper A')] });
  const f = redFlags('2026-10-15', one, cfg, 73).find((x) => x.key === 'missed');
  assert.match(f.text, /gym 1\/3, runs 0\/2 with 3 days left/);
});

test('maintenance is right early in a cut (slope of the weigh-ins, not the lagging trend)', () => {
  // 2000 kcal a day, losing 0.1 kg a day for 21 days → maintenance ≈ 2000 + 770 = 2770
  const d = days('2026-10-01', 21);
  const r = adaptiveTdee('2026-10-21', { weights: d.map((x, i) => ({ day: x, kg: 90 - i * 0.1 })), kcalOf: () => 2000 });
  assert.equal(r.tdee, 2770);
  assert.equal(r.perWeek, -0.7);
  // only 5 weigh-ins: not enough to tell
  assert.equal(adaptiveTdee('2026-10-21', { weights: d.slice(-5).map((x, i) => ({ day: x, kg: 90 - i * 0.1 })), kcalOf: () => 2000 }), null);
});
