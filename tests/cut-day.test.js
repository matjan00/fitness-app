import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextLift, sessionFor, sessionDone, dayFacts, dayStatus, streak, weekStreak, minimumDaysInWeek, liftLetter } from '../docs/cut-day.js';

const W = (day, name, extra = {}) => ({ name, started_at: `${day}T10:00:00`, ended_at: `${day}T11:00:00`, ...extra });

test('rotation never skips: next lift follows the last finished A/B/C workout', () => {
  assert.equal(nextLift([], '2026-10-12'), 'A');
  assert.equal(nextLift([W('2026-10-12', 'Upper A')], '2026-10-14'), 'B');
  assert.equal(nextLift([W('2026-10-12', 'Upper A'), W('2026-10-14', 'Upper B'), W('2026-10-16', 'Upper C')], '2026-10-19'), 'A');
  // B missed on Wednesday → B is still next on Friday
  assert.equal(nextLift([W('2026-10-12', 'Upper A')], '2026-10-16'), 'B');
  // unfinished and same-day workouts don't count; other workouts are ignored
  assert.equal(nextLift([W('2026-10-12', 'Upper A'), { name: 'Upper B', started_at: '2026-10-13T10:00:00' }, W('2026-10-13', 'Arms')], '2026-10-14'), 'B');
  assert.equal(nextLift([W('2026-10-14', 'Upper A')], '2026-10-14'), 'A');
  // routine link wins over the name
  assert.equal(liftLetter({ routine_id: 'r1', name: 'x' }, (id) => (id === 'r1' ? 'C' : null)), 'C');
});

test('sessionFor uses the example week', () => {
  assert.equal(sessionFor('2026-10-12').kind, 'lift'); // Monday
  assert.equal(sessionFor('2026-10-12').routine.name, 'Upper A');
  assert.equal(sessionFor('2026-10-13').kind, 'easy');
  assert.equal(sessionFor('2026-10-15').kind, 'quality');
  assert.equal(sessionFor('2026-10-17').kind, 'steps');
  assert.equal(sessionFor('2026-10-18').kind, 'rest');
  assert.equal(sessionFor('2026-10-14', { workouts: [W('2026-10-12', 'Upper A')] }).letter, 'B');
});

test('sessionDone', () => {
  assert.equal(sessionDone('lift', '2026-10-12', { workouts: [W('2026-10-12', 'Upper A')] }), true);
  assert.equal(sessionDone('lift', '2026-10-12', { workouts: [{ started_at: '2026-10-12T10:00:00' }] }), false);
  assert.equal(sessionDone('easy', '2026-10-13', { runs: [{ start: '2026-10-13T07:00:00' }] }), true);
  assert.equal(sessionDone('rest', '2026-10-13'), false);
});

test('dayFacts: typed totals win over the food diary', () => {
  const meals = [{ day: '2026-10-12', kcal: 1000, p: 80 }, { day: '2026-10-12', kcal: 700.4, p: 70 }];
  const f = dayFacts('2026-10-12', { weights: [{ day: '2026-10-12', kg: 73 }], meals, dailies: [] });
  assert.equal(f.kcal, 1700);
  assert.equal(f.p, 150);
  assert.equal(f.weight, 73);
  assert.equal(f.logged, true);
  const g = dayFacts('2026-10-12', { meals, dailies: [{ day: '2026-10-12', kcal: 1800, steps: 9000 }] });
  assert.equal(g.kcal, 1800);
  assert.equal(g.p, 150);
  assert.equal(g.steps, 9000);
  assert.equal(dayFacts('2026-10-13', {}).logged, false);
});

const good = { weight: 73, p: 150, kcal: 1750, steps: 10500, sleep: 7.5, minimum: false };
const opt = { kcalTarget: 1750, session: { kind: 'lift' }, done: true };

test('green / yellow / red', () => {
  assert.equal(dayStatus(good, opt).status, 'green');
  assert.equal(dayStatus({ ...good, steps: 8500 }, opt).status, 'yellow');
  assert.equal(dayStatus({ ...good, steps: 7000 }, opt).status, 'red');
  assert.equal(dayStatus({ ...good, kcal: 1900 }, opt).status, 'red');
  assert.equal(dayStatus({ ...good, kcal: 1850 }, opt).status, 'green');
  assert.equal(dayStatus(good, { ...opt, done: false }).status, 'red');
  assert.equal(dayStatus(good, { ...opt, session: { kind: 'rest' }, done: false }).status, 'green');
  assert.equal(dayStatus({ ...good, sleep: null }, { ...opt, isToday: true }).status, 'open');
  // minimum day: weigh-in + protein + 6,000 steps
  const min = { weight: 73, p: 145, kcal: 2400, steps: 6200, sleep: 5, minimum: true };
  assert.equal(dayStatus(min, opt).status, 'yellow');
  assert.equal(dayStatus({ ...min, steps: 5000 }, opt).status, 'red');
  assert.equal(dayStatus({ ...min, minimum: false }, opt).status, 'red');
  assert.equal(dayStatus(good, opt).checks.length, 6);
});

test('streaks', () => {
  const okDays = new Set(['2026-10-10', '2026-10-11', '2026-10-12']);
  const ok = (d) => okDays.has(d);
  assert.equal(streak('2026-10-12', ok), 3);
  assert.equal(streak('2026-10-13', ok), 3); // today not done yet doesn't break it
  assert.equal(streak('2026-10-14', ok), 0);
  assert.equal(weekStreak('2026-10-18', ['2026-10-18', '2026-10-11', '2026-10-04', '2026-09-20']), 3);
  assert.equal(weekStreak('2026-10-20', ['2026-10-18', '2026-10-11']), 2);
  assert.equal(weekStreak('2026-10-27', ['2026-10-18']), 0);
  assert.equal(minimumDaysInWeek('2026-10-14', [{ day: '2026-10-12', minimum: true }, { day: '2026-10-11', minimum: true }, { day: '2026-10-13' }]), 1);
});

test('lifting-day calorie bonus', async () => {
  const { liftDayExtra } = await import('../docs/cut-day.js');
  const cfg = { startDate: '2026-10-12', liftDayBonus: 150 };
  assert.equal(liftDayExtra('2026-10-12', { cfg }), 150); // Monday = planned lift day
  assert.equal(liftDayExtra('2026-10-13', { cfg }), 0); // Tuesday = easy run
  assert.equal(liftDayExtra('2026-10-13', { cfg, workouts: [W('2026-10-13', 'Upper B')] }), 150); // lifted anyway
  assert.equal(liftDayExtra('2026-10-12', { cfg: { startDate: '2026-10-12' } }), 0); // no bonus set
  assert.equal(liftDayExtra('2026-10-05', { cfg }), 0); // before the start
});

test('travel days: only the weigh-in counts', () => {
  const t = { weight: 73, p: 60, kcal: null, steps: 2000, sleep: 5, travel: true };
  assert.equal(dayStatus(t, { kcalTarget: 1750, session: { kind: 'lift' } }).status, 'green');
  assert.equal(dayStatus({ ...t, kcal: 2000 }, { kcalTarget: 1750 }).status, 'green'); // within ±300
  assert.equal(dayStatus({ ...t, kcal: 2200 }, { kcalTarget: 1750 }).status, 'yellow');
  assert.equal(dayStatus({ ...t, weight: null }, { kcalTarget: 1750 }).status, 'red');
  assert.equal(dayStatus({ ...t, weight: null }, { kcalTarget: 1750, isToday: true }).status, 'open');
  // no session expected; the rotation is unaffected
  assert.equal(sessionFor('2026-10-12', { dailies: [{ day: '2026-10-12', travel: true }] }).kind, 'travel');
  assert.equal(sessionFor('2026-10-14', { dailies: [{ day: '2026-10-12', travel: true }] }).letter, 'A');
});
