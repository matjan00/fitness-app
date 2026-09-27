import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRun, runRecordId, mapActivity, planSync, summarySig } from '../supabase/functions/strava/map.js';

const USER = '3f2a9c10-1111-4222-8333-444455556666';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const summary = (id, over = {}) => ({
  id, name: 'Morning Run', type: 'Run', sport_type: 'Run', start_date: '2026-09-20T06:10:00Z', start_date_local: '2026-09-20T08:10:00Z',
  distance: 8012.4, moving_time: 2901, elapsed_time: 2990, total_elevation_gain: 41.3, average_heartrate: 148.36, max_heartrate: 171,
  average_cadence: 84.6, average_speed: 2.762, max_speed: 4.1, suffer_score: 42, workout_type: 0, map: { summary_polyline: 'abc' }, trainer: false,
  ...over,
});
const detail = (id) => ({
  ...summary(id), description: 'Nice one', calories: 540,
  splits_metric: [
    { split: 1, distance: 1000.2, moving_time: 362, elapsed_time: 365, average_heartrate: 140.2, elevation_difference: 3.1 },
    { split: 2, distance: 1001, moving_time: 358, elapsed_time: 358, average_heartrate: 147.9, elevation_difference: -1 },
    { split: 3, distance: 12, moving_time: 0, elapsed_time: 0 },
  ],
  laps: [{ lap_index: 1, distance: 8012.4, moving_time: 2901, average_heartrate: 148.4, average_cadence: 84 }],
  best_efforts: [
    { name: '1k', elapsed_time: 351, moving_time: 351, distance: 1000, pr_rank: null },
    { name: '5k', elapsed_time: 1790, moving_time: 1790, distance: 5000, pr_rank: 2 },
  ],
  segment_efforts: [{ big: 'ignored' }],
});

test('isRun keeps runs, trail runs, virtual runs and treadmill', () => {
  assert.ok(isRun({ type: 'Run' }));
  assert.ok(isRun({ sport_type: 'TrailRun', type: 'Run' }));
  assert.ok(isRun({ sport_type: 'VirtualRun' }));
  assert.ok(isRun({ type: 'Treadmill' }));
  assert.ok(!isRun({ type: 'Ride', sport_type: 'Ride' }));
  assert.ok(!isRun({ sport_type: 'Walk', type: 'Walk' }));
  assert.ok(!isRun(null));
});

test('record ids are deterministic valid UUIDs per user + activity', () => {
  const a = runRecordId(USER, 12345678901);
  assert.match(a, UUID);
  assert.equal(a, runRecordId(USER, '12345678901'));
  assert.notEqual(a, runRecordId(USER, 12345678902));
  assert.notEqual(a, runRecordId('aaaaaaaa-1111-4222-8333-444455556666', 12345678901));
  assert.ok(a.endsWith((12345678901).toString(16).padStart(12, '0')));
  assert.match(runRecordId(USER, 99999999999999), UUID);
});

test('mapActivity maps a summary compactly', () => {
  const d = mapActivity(summary(42));
  assert.equal(d.strava_id, '42');
  assert.equal(d.distance_m, 8012.4);
  assert.equal(d.moving_s, 2901);
  assert.equal(d.avg_hr, 148.4);
  assert.equal(d.avg_cadence, 169); // per-leg 84.6 → steps/min
  assert.equal(d.start, '2026-09-20T06:10:00Z');
  assert.equal(d.polyline, 'abc');
  assert.equal(d.detail, false);
  assert.equal(d.sig, summarySig(summary(42)));
  assert.equal(d.splits, undefined);
  assert.ok(!('trainer' in d));
  const t = mapActivity(summary(43, { type: 'Treadmill', sport_type: undefined, map: null, average_heartrate: null }));
  assert.equal(t.type, 'Run');
  assert.equal(t.trainer, true);
  assert.ok(!('avg_hr' in t) && !('polyline' in t));
});

test('mapActivity with details adds splits, laps and best efforts', () => {
  const d = mapActivity(summary(42), detail(42));
  assert.equal(d.detail, true);
  assert.deepEqual(d.splits, [{ km: 1, d: 1000.2, s: 362, hr: 140.2, elev: 3.1 }, { km: 2, d: 1001, s: 358, hr: 147.9, elev: -1 }]);
  assert.deepEqual(d.laps, [{ n: 1, d: 8012.4, s: 2901, hr: 148.4, cad: 168 }]);
  assert.deepEqual(d.best_efforts, [{ name: '1k', s: 351, distance: 1000, pr_rank: null }, { name: '5k', s: 1790, distance: 5000, pr_rank: 2 }]);
  assert.equal(d.description, 'Nice one');
  assert.ok(!('segment_efforts' in d));
  assert.ok(JSON.stringify(d).length < 2000);
});

test('planSync fetches details only for new or changed runs', () => {
  const existing = [
    { id: 'a', data: { strava_id: '1', sig: summarySig(summary(1)), detail: true, start: '2026-09-20T06:10:00Z' } },
    { id: 'b', data: { strava_id: '2', sig: 'old', detail: true, start: '2026-09-21T06:10:00Z' } },
    { id: 'c', data: { strava_id: '3', sig: summarySig(summary(3)), detail: false, start: '2026-09-22T06:10:00Z' } },
    { id: 'd', data: { strava_id: '9', sig: 'x', detail: true, start: '2026-09-23T06:10:00Z' } }, // deleted on Strava
    { id: 'e', data: { strava_id: '8', sig: 'x', detail: true, start: '2025-01-01T06:10:00Z' } }, // outside window
  ];
  const summaries = [
    summary(1), summary(2), summary(3, { start_date: '2026-09-22T06:10:00Z' }),
    summary(4, { start_date: '2026-09-25T06:00:00Z' }), summary(5, { type: 'Ride', sport_type: 'Ride' }),
  ];
  const p = planSync({ userId: USER, summaries, existing, windowStart: Date.parse('2026-09-01'), listComplete: true });
  assert.deepEqual(p.needDetail.map((a) => a.id), [4, 3, 2]); // newest first, ride ignored
  assert.equal(p.unchanged, 1);
  assert.deepEqual(p.toDelete, ['d']);
  assert.equal(p.recordId(summary(4)), runRecordId(USER, 4));
  const partial = planSync({ userId: USER, summaries, existing, windowStart: Date.parse('2026-09-01'), listComplete: false });
  assert.deepEqual(partial.toDelete, []);
});
