import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDay, addDays, parseSteps, daysToTotal, dayTotal, mergeSteps } from '../supabase/functions/steps-webhook/logic.js';

const s = (start, end, count) => ({ start_time: start, end_time: end, count });

test('localDay uses Warsaw time, also across midnight and DST', () => {
  assert.equal(localDay('2026-10-12T21:59:00Z'), '2026-10-12'); // 23:59 CEST
  assert.equal(localDay('2026-10-12T22:01:00Z'), '2026-10-13'); // 00:01 CEST
  assert.equal(localDay('2026-12-01T23:30:00Z'), '2026-12-02'); // 00:30 CET
});

test('addDays crosses month ends', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('parseSteps keeps valid intervals and drops junk', () => {
  const out = parseSteps({
    timestamp: 'x',
    steps: [
      { count: 120, start_time: '2026-10-12T08:00:00Z', end_time: '2026-10-12T08:05:00.000Z' },
      { count: -1, start_time: '2026-10-12T08:00:00Z', end_time: '2026-10-12T08:05:00Z' },
      { count: 1.5, start_time: '2026-10-12T08:00:00Z', end_time: '2026-10-12T08:05:00Z' },
      { count: 10, start_time: 'nope', end_time: '2026-10-12T08:05:00Z' },
      { count: 10, start_time: '2026-10-12T09:00:00Z', end_time: '2026-10-12T08:00:00Z' },
      { count: 999999, start_time: '2026-10-12T08:00:00Z', end_time: '2026-10-12T08:05:00Z' },
      null,
    ],
  });
  assert.deepEqual(out, [s('2026-10-12T08:00:00.000Z', '2026-10-12T08:05:00.000Z', 120)]);
  assert.deepEqual(parseSteps({}), []);
  assert.deepEqual(parseSteps(null), []);
});

test('daysToTotal: finished days only, always yesterday', () => {
  const samples = [s('2026-10-11T10:00:00Z', 'x', 1), s('2026-10-13T06:00:00Z', 'x', 1), s('2026-10-12T22:30:00Z', 'x', 1)];
  assert.deepEqual(daysToTotal(samples, '2026-10-13'), ['2026-10-11', '2026-10-12']);
  assert.deepEqual(daysToTotal([], '2026-10-13'), ['2026-10-12']);
});

test('dayTotal sums by start day, null when nothing recorded', () => {
  const samples = [s('2026-10-12T06:00:00Z', '2026-10-12T06:10:00Z', 1000), s('2026-10-12T21:50:00Z', '2026-10-12T21:55:00Z', 200), s('2026-10-12T22:10:00Z', '2026-10-12T22:15:00Z', 50)];
  assert.equal(dayTotal(samples, '2026-10-12'), 1200);
  assert.equal(dayTotal(samples, '2026-10-13'), 50);
  assert.equal(dayTotal(samples, '2026-10-10'), null);
});

test('dayTotal counts a growing all-day record once, at its latest size', () => {
  const growing = [
    s('2026-10-12T22:00:00Z', '2026-10-13T11:05:00Z', 8),
    s('2026-10-12T22:00:00Z', '2026-10-13T19:00:00Z', 6400),
    s('2026-10-12T22:00:00Z', '2026-10-13T21:59:00Z', 9100),
  ];
  assert.equal(dayTotal(growing, '2026-10-13'), 9100);
  // small back-to-back intervals all count; a re-sent copy of one does not
  const small = [
    s('2026-10-13T06:00:00Z', '2026-10-13T06:05:00Z', 300),
    s('2026-10-13T06:05:00Z', '2026-10-13T06:10:00Z', 250),
    s('2026-10-13T06:00:00Z', '2026-10-13T06:05:00Z', 300),
  ];
  assert.equal(dayTotal(small, '2026-10-13'), 550);
});

test('mergeSteps adds the steps typed by hand, keeps old typed totals, skips no-ops', () => {
  const day = '2026-10-12';
  assert.deepEqual(mergeSteps(null, day, 8400), { day, steps: 8400, stepsPhone: 8400, stepsSource: 'phone' });
  assert.deepEqual(mergeSteps({ day, sleepHours: 7 }, day, 8400), { day, sleepHours: 7, steps: 8400, stepsPhone: 8400, stepsSource: 'phone' });
  // added by hand before the phone's count arrived
  assert.deepEqual(mergeSteps({ day, steps: 2000, stepsExtra: 2000 }, day, 8400), { day, steps: 10400, stepsExtra: 2000, stepsPhone: 8400, stepsSource: 'phone' });
  // phone count grows, the hand-added part stays
  assert.deepEqual(mergeSteps({ day, steps: 10400, stepsExtra: 2000, stepsPhone: 8400, stepsSource: 'phone' }, day, 9000), { day, steps: 11000, stepsExtra: 2000, stepsPhone: 9000, stepsSource: 'phone' });
  // hand-added part cleared
  assert.deepEqual(mergeSteps({ day, steps: null, stepsExtra: null }, day, 8400), { day, steps: 8400, stepsExtra: null, stepsPhone: 8400, stepsSource: 'phone' });
  // a whole-day total typed before this option existed is left alone
  assert.equal(mergeSteps({ steps: 9000 }, day, 8400), null);
  assert.equal(mergeSteps({ steps: 9000, stepsSource: null }, day, 8400), null);
  assert.equal(mergeSteps({ steps: 8400, stepsPhone: 8400, stepsSource: 'phone' }, day, 8400), null);
  assert.equal(mergeSteps({}, day, null), null);
});
