import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wallTime, dayToJudge, statusFromRecords } from '../supabase/functions/day-status/logic.js';

// 2026-11-14 is a Saturday: its week runs Mon 9 – Sun 15 November.
const DAY = '2026-11-14';
const rec = (kind, data, id = `${kind}-${Math.random()}`) => ({ id, kind, data });
const lift = (startUtc) => rec('workout', { started_at: startUtc, ended_at: startUtc, name: 'Upper A' });
const good = () => [
  rec('bodyweight', { day: DAY, kg: 70.2 }),
  rec('daily', { day: DAY, sleepHours: 8, steps: 10200, kcal: 1950, p: 128 }),
  rec('config', { key: 'food', targets: { kcal: 1900, p: 130, f: 60, c: 210 } }),
  lift('2026-11-10T16:00:00Z'),
  lift('2026-11-12T16:00:00Z'),
  // cardio Mon–Thu: 4 of 5 done, the last one fits on Sunday
  ...['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'].map((day) => rec('daily', { day, cardio: true })),
];

test('wallTime gives Warsaw wall-clock time without a zone', () => {
  assert.equal(wallTime('2026-11-13T23:30:00Z'), '2026-11-14T00:30:00'); // CET
  assert.equal(wallTime('2026-07-01T22:15:00Z'), '2026-07-02T00:15:00'); // CEST
});

test('dayToJudge defaults to yesterday and refuses unfinished or bad days', () => {
  const now = Date.parse('2026-11-15T07:15:00Z'); // 08:15 in Warsaw
  assert.equal(dayToJudge(null, now), '2026-11-14');
  assert.equal(dayToJudge('', now), '2026-11-14');
  assert.equal(dayToJudge('2026-11-01', now), '2026-11-01');
  assert.equal(dayToJudge('2026-11-15', now), null);
  assert.equal(dayToJudge('2026-11-16', now), null);
  assert.equal(dayToJudge('14.11.2026', now), null);
  assert.equal(dayToJudge('2026-13-45', now), null);
  // 00:30 in Warsaw is already the next day, though it is still the 14th in UTC
  assert.equal(dayToJudge(null, Date.parse('2026-11-14T23:30:00Z')), '2026-11-14');
});

test('a day with every check met is green', () => {
  const r = statusFromRecords(DAY, good());
  assert.equal(r.status, 'green');
  assert.equal(r.red, false);
  assert.ok(r.checks.every((c) => c.ok));
});

test('no weigh-in makes the day red', () => {
  const r = statusFromRecords(DAY, good().filter((x) => x.kind !== 'bodyweight'));
  assert.equal(r.status, 'red');
  assert.equal(r.red, true);
  assert.equal(r.checks.find((c) => c.label === 'Weighed in').ok, false);
});

test('steps between 8,000 and 10,000 are yellow, under 8,000 red', () => {
  const at = (patch) => statusFromRecords(DAY, good().map((x) => (x.kind === 'daily' ? rec('daily', { ...x.data, ...patch }) : x))).status;
  assert.equal(at({ steps: 9000 }), 'yellow');
  assert.equal(at({ steps: 7000 }), 'red');
  assert.equal(at({ steps: 7000, bikeKm: 20 }), 'red'); // bike km no longer count
});

test('calories and protein come only from what was typed in', () => {
  const at = (patch, extra = []) => statusFromRecords(DAY, [...good().map((x) => (x.kind === 'daily' ? rec('daily', { ...x.data, ...patch }) : x)), ...extra]).status;
  assert.equal(at({ kcal: 2150 }), 'red'); // over 1,900 + 100
  assert.equal(at({ p: 110 }), 'red');     // under 120 g
  // a Fitatu day on target does not stand in for totals that were not typed in
  assert.equal(at({ kcal: null, p: null }, [rec('fitatu-day', { day: DAY, kcal: 1900, p: 140 })]), 'red');
});

test('the week check counts gym sessions on Warsaw days', () => {
  // Only one session earlier in the week: 2 still needed with only Sunday left → off track → red.
  const one = good().filter((x) => !(x.kind === 'workout' && x.data.started_at.startsWith('2026-11-12')));
  assert.equal(statusFromRecords(DAY, one).status, 'red');
  // 00:30 on the 14th in Warsaw (23:30 UTC on the 13th) is a session on the 14th, so the week is on track again.
  assert.equal(statusFromRecords(DAY, [...one, lift('2026-11-13T23:30:00Z')]).status, 'green');
});

test('a travel day only needs the weigh-in', () => {
  const r = statusFromRecords(DAY, [rec('bodyweight', { day: DAY, kg: 70 }), rec('daily', { day: DAY, travel: true }), rec('config', { key: 'food', targets: { kcal: 1900 } })]);
  assert.equal(r.status, 'green');
});

test('cut settings from the config record are used', () => {
  const cfg = rec('config', { key: 'cut', sleep: 9 });
  assert.equal(statusFromRecords(DAY, [...good(), cfg]).status, 'red');
});

test('cardio ticks count for the week', () => {
  const cfg = rec('config', { key: 'cut', cardioWeek: 5 });
  // Saturday: 5 cardio sessions needed, Sunday is the only day left → off track → red
  const noTicks = good().filter((x) => !(x.kind === 'daily' && x.data.cardio));
  assert.equal(statusFromRecords(DAY, [...noTicks, cfg]).status, 'red');
  assert.equal(statusFromRecords(DAY, [...good(), cfg]).status, 'green'); // 4 done, 1 to go on Sunday
  assert.equal(statusFromRecords(DAY, [...noTicks, rec('config', { key: 'cut', cardioWeek: 0 })]).status, 'green');
});
