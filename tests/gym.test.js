import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  e1rm, muscleGroup, exGroups, defaultMode, computePRs, lastSessions, previousSet, weeklySeries, muscleSets,
  weekStreak, workoutVolume, workoutSetCount, bestSet, formatSet, parseDuration, fmtDur, firstInt, sortExercises,
  matchesSearch, recentUse, exerciseRecords, exerciseSeries, routineFromWorkout, routineChanged, weekKey,
  parseRepRange, suggestNext, weightStep, trend, isStalled, deloadKg, progressList,
} from '../docs/gym-calc.js';

const W = (id, date, exercises) => ({ id, name: id, started_at: date, ended_at: new Date(Date.parse(date) + 3600e3).toISOString(), exercises });
const S = (kg, reps, type = 'n') => ({ type, kg, reps });

test('e1rm uses Epley for 1–12 reps only', () => {
  assert.equal(e1rm(100, 1), 100);
  assert.equal(e1rm(100, 5), 116.7);
  assert.equal(e1rm(60, 10), 80);
  assert.equal(e1rm(100, 13), null);
  assert.equal(e1rm(0, 5), null);
  assert.equal(e1rm(100, 0), null);
});

test('muscle mapping and groups', () => {
  assert.equal(muscleGroup('lats'), 'Back');
  assert.equal(muscleGroup('middle back'), 'Back');
  assert.equal(muscleGroup('quadriceps'), 'Legs');
  assert.equal(muscleGroup('abdominals'), 'Core');
  assert.equal(muscleGroup('nothing'), null);
  assert.deepEqual(exGroups({ p: ['lats', 'traps', 'biceps'] }), ['Back', 'Biceps']);
  assert.deepEqual(exGroups({ g: 'Chest', p: [] }), ['Chest']);
});

test('default tracking type', () => {
  assert.equal(defaultMode({ n: 'Bench', eq: 'barbell', c: 'strength' }), 'wr');
  assert.equal(defaultMode({ n: 'Pullups', eq: 'body only', c: 'strength' }), 'bw');
  assert.equal(defaultMode({ n: 'Plank', eq: 'body only', c: 'strength' }), 't');
  assert.equal(defaultMode({ n: 'Rowing', eq: 'machine', c: 'cardio' }), 't');
  assert.equal(defaultMode({ n: 'Stretch', eq: 'other', c: 'stretching' }), 't');
  assert.equal(defaultMode({ n: 'Custom', mode: 'bw' }), 'bw');
});

test('volume, set count, best set, formatting', () => {
  const w = W('a', '2026-01-05T10:00:00Z', [
    { exercise_id: 'bench', mode: 'wr', sets: [S(40, 10, 'w'), S(60, 8), S(62.5, 6)] },
    { exercise_id: 'plank', mode: 't', sets: [{ type: 'n', secs: 60 }] },
  ]);
  assert.equal(workoutVolume(w), 60 * 8 + 62.5 * 6);
  assert.equal(workoutSetCount(w), 4);
  assert.deepEqual(bestSet(w.exercises[0]), S(62.5, 6));
  assert.equal(formatSet(S(62.5, 6)), '62.5 × 6');
  assert.equal(formatSet({ type: 'n', kg: null, reps: 12 }, 'bw'), '12 reps');
  assert.equal(formatSet({ type: 'n', kg: 10, reps: 8 }, 'bw'), '+10 × 8');
  assert.equal(formatSet({ type: 'n', secs: 75 }, 't'), '1:15');
});

test('durations and targets', () => {
  assert.equal(parseDuration('1:30'), 90);
  assert.equal(parseDuration('45'), 45);
  assert.equal(parseDuration('1:02:03'), 3723);
  assert.equal(parseDuration(''), null);
  assert.equal(parseDuration('abc'), null);
  assert.equal(fmtDur(605), '10:05');
  assert.equal(firstInt('8-12'), 8);
  assert.equal(firstInt(''), null);
});

test('PR detection: first session is baseline, later improvements are PRs, warm-ups ignored', () => {
  const ws = [
    W('w1', '2026-01-01T10:00:00Z', [{ exercise_id: 'bench', mode: 'wr', sets: [S(60, 8), S(60, 8)] }]),
    W('w2', '2026-01-03T10:00:00Z', [{ exercise_id: 'bench', mode: 'wr', sets: [S(100, 1, 'w'), S(60, 10), S(62.5, 5)] }]),
    W('w3', '2026-01-05T10:00:00Z', [{ exercise_id: 'bench', mode: 'wr', sets: [S(50, 5)] }]),
    W('w4', '2026-01-07T10:00:00Z', [{ exercise_id: 'pull', mode: 'bw', sets: [{ type: 'n', reps: 8 }] }]),
    W('w5', '2026-01-09T10:00:00Z', [{ exercise_id: 'pull', mode: 'bw', sets: [{ type: 'n', reps: 10 }] }]),
  ];
  const prs = computePRs([...ws].reverse()); // order independent
  assert.deepEqual(prs.get('w1'), []);
  const w2 = prs.get('w2');
  const kinds = Object.fromEntries(w2.map((p) => [p.kind, p]));
  assert.equal(kinds.kg.value, 62.5);
  assert.equal(kinds.kg.si, 2);
  assert.equal(kinds.kg.prev, 60);
  assert.equal(kinds.e1rm.value, 80); // 60×10
  assert.equal(kinds.vol.value, 600);
  assert.deepEqual(prs.get('w3'), []);
  assert.deepEqual(prs.get('w4'), []);
  assert.equal(prs.get('w5')[0].kind, 'reps');
});

test('previous sets come from the latest earlier session', () => {
  const ws = [
    W('w1', '2026-01-01T10:00:00Z', [{ exercise_id: 'bench', mode: 'wr', sets: [S(60, 8)] }]),
    W('w2', '2026-01-03T10:00:00Z', [{ exercise_id: 'bench', mode: 'wr', sets: [S(65, 8), S(65, 7)] }]),
  ];
  const last = lastSessions(ws);
  assert.deepEqual(previousSet(last.get('bench'), 1), S(65, 7));
  assert.equal(previousSet(last.get('bench'), 5), null);
  assert.equal(previousSet(last.get('squat'), 0), null);
  const before = lastSessions(ws, { before: Date.parse('2026-01-02T00:00:00Z') });
  assert.deepEqual(previousSet(before.get('bench'), 0), S(60, 8));
  assert.deepEqual(lastSessions(ws, { exceptId: 'w2' }).get('bench').sets, [S(60, 8)]);
  // Warm-ups match warm-ups, working sets match working sets.
  const sess = { sets: [S(40, 10, 'w'), S(60, 8), S(62.5, 6)] };
  const today = [S(null, null), S(null, null), S(null, null)];
  assert.deepEqual(previousSet(sess, 0, today), S(60, 8));
  assert.deepEqual(previousSet(sess, 1, today), S(62.5, 6));
  assert.equal(previousSet(sess, 2, today), null);
  const withWarm = [S(null, null, 'w'), S(null, null)];
  assert.deepEqual(previousSet(sess, 0, withWarm), S(40, 10, 'w'));
  assert.deepEqual(previousSet(sess, 1, withWarm), S(60, 8));
});

test('weekly series, muscle sets and streak', () => {
  const now = new Date(2026, 0, 21, 12).getTime(); // Wed 21 Jan 2026
  const ws = [
    W('a', new Date(2026, 0, 19, 18).toISOString(), [{ exercise_id: 'bench', mode: 'wr', sets: [S(50, 10), S(50, 10, 'w')] }]),
    W('b', new Date(2026, 0, 13, 18).toISOString(), [{ exercise_id: 'squat', mode: 'wr', sets: [S(80, 5)] }]),
    W('c', new Date(2026, 0, 6, 18).toISOString(), [{ exercise_id: 'squat', mode: 'wr', sets: [S(80, 5)] }]),
    W('old', new Date(2025, 5, 1, 18).toISOString(), [{ exercise_id: 'squat', mode: 'wr', sets: [S(80, 5)] }]),
  ];
  const s = weeklySeries(ws, 12, now);
  assert.equal(s.length, 12);
  assert.equal(s[11].week, '2026-01-19');
  assert.equal(s[11].count, 1);
  assert.equal(s[11].volume, 500);
  assert.equal(s[10].count, 1);
  assert.equal(s.reduce((a, r) => a + r.count, 0), 3);
  const groups = { bench: ['Chest', 'Triceps'], squat: ['Legs'] };
  assert.deepEqual(muscleSets(ws, (id) => groups[id], now - 7 * 864e5), { Chest: 1, Triceps: 1 });
  assert.equal(weekStreak(ws, now), 3);
  assert.equal(weekStreak(ws, new Date(2026, 0, 27, 12).getTime()), 3); // no workout yet this week
  assert.equal(weekStreak(ws, new Date(2026, 1, 10, 12).getTime()), 0);
  assert.equal(weekKey(new Date(2026, 0, 25, 23)), '2026-01-19'); // Sunday belongs to Monday's week
});

test('library search and ordering', () => {
  const list = [
    { id: 'z', n: 'Zercher Squat' },
    { id: 'b', n: 'Barbell Squat', pop: 2 },
    { id: 'a', n: 'Air Squat' },
    { id: 'p', n: 'Bench Press', pop: 1 },
  ];
  const recent = recentUse([W('w', '2026-01-01T10:00:00Z', [{ exercise_id: 'z', sets: [] }])]);
  assert.deepEqual(sortExercises(list, recent).map((e) => e.id), ['z', 'p', 'b', 'a']);
  assert.ok(matchesSearch({ n: 'Barbell Bench Press - Medium Grip' }, 'bench barbell'));
  assert.ok(!matchesSearch({ n: 'Barbell Squat' }, 'bench barbell'));
  assert.ok(matchesSearch({ n: 'Anything' }, '  '));
});

test('exercise records and series', () => {
  const ws = [
    W('w1', '2026-01-01T10:00:00Z', [{ exercise_id: 'bench', mode: 'wr', sets: [S(60, 8), S(70, 3)] }]),
    W('w2', '2026-01-03T10:00:00Z', [{ exercise_id: 'bench', mode: 'wr', sets: [S(65, 8)] }]),
  ];
  const r = exerciseRecords(ws, 'bench');
  assert.equal(r.kg.value, 70);
  assert.equal(r.kg.workout_id, 'w1');
  assert.equal(r.e1rm.value, 82.3); // 65×8
  assert.equal(r.vol.value, 520);
  const s = exerciseSeries(ws, 'bench');
  assert.equal(s.length, 2);
  assert.equal(s[0].kg, 70);
  assert.equal(s[1].e1rm, 82.3);
});

test('routine update from a workout keeps rep ranges', () => {
  const old = { exercises: [{ exercise_id: 'bench', sets: 3, reps: '8-12', kg: 60, rest: 120 }] };
  const w = W('w', '2026-01-01T10:00:00Z', [
    { exercise_id: 'bench', mode: 'wr', rest: 120, sets: [S(40, 10, 'w'), S(65, 8), S(65, 8), S(65, 7), S(65, 6)] },
    { exercise_id: 'plank', mode: 't', rest: 60, sets: [{ type: 'n', secs: 60 }] },
  ]);
  const ex = routineFromWorkout(w, old);
  assert.deepEqual(ex[0], { exercise_id: 'bench', sets: 4, reps: '8-12', kg: 65, rest: 120 });
  assert.deepEqual(ex[1], { exercise_id: 'plank', sets: 1, reps: '60', kg: null, rest: 60 });
  assert.ok(routineChanged(old.exercises, ex));
  assert.ok(!routineChanged(ex, JSON.parse(JSON.stringify(ex))));
  // Exercises skipped today stay in the routine unchanged.
  const old2 = { exercises: [{ exercise_id: 'squat', sets: 3, reps: '5', kg: 100, rest: 180 }, old.exercises[0]] };
  const ex2 = routineFromWorkout(w, old2);
  assert.deepEqual(ex2.map((x) => x.exercise_id), ['squat', 'bench', 'plank']);
  assert.deepEqual(ex2[0], old2.exercises[0]);
  assert.equal(formatSet(S(62.5, 6), 'wr', true), '62.5 kg × 6');
});

test('parseRepRange reads ranges and single targets', () => {
  assert.deepEqual(parseRepRange('8-12'), { lo: 8, hi: 12 });
  assert.deepEqual(parseRepRange('12 - 8'), { lo: 8, hi: 12 });
  assert.deepEqual(parseRepRange('10'), { lo: 10, hi: 10 });
  assert.equal(parseRepRange(''), null);
});

test('suggestNext: add weight at top of range, otherwise +1 rep', () => {
  const r = { lo: 8, hi: 12 };
  const up = suggestNext([S(60, 12), S(60, 12), S(60, 12)], r, 2.5);
  assert.equal(up.kind, 'weight');
  assert.equal(up.text, 'Go up: 62.5 kg × 8');
  assert.equal(suggestNext([S(60, 12), S(60, 12)], r, 5).kg, 65);
  const rep = suggestNext([S(60, 12), S(60, 10), S(60, 9)], r, 2.5);
  assert.equal(rep.kind, 'rep');
  assert.equal(rep.text, '60 kg — aim for 12 reps on every set, then go up');
  // warm-ups are ignored, lighter back-off sets don't block progress at the top weight
  assert.equal(suggestNext([S(20, 12, 'w'), S(60, 12), S(50, 8)], r, 2.5).kind, 'weight');
  assert.equal(suggestNext([], r), null);
  assert.equal(suggestNext([S(0, 10)], r), null);
  assert.equal(suggestNext([S(60, 12)], null, 2.5).kind, 'weight'); // default 8-12
});

test('weightStep: 5 kg lower body, 2.5 kg upper body', () => {
  assert.equal(weightStep(['Legs']), 5);
  assert.equal(weightStep(['Chest', 'Triceps']), 2.5);
  assert.equal(weightStep([]), 2.5);
});

const row = (e1) => ({ e1rm: e1, kg: 0, reps: 0, secs: 0 });
test('trend compares the latest session with the average of the previous ones', () => {
  assert.equal(trend([row(100)]), null);
  assert.equal(trend([row(100), row(100), row(110)]), 'up');
  assert.equal(trend([row(100), row(100), row(101)]), 'flat');
  assert.equal(trend([row(100), row(110), row(90)]), 'down');
});

test('isStalled needs 3 sessions without beating the earlier best', () => {
  assert.equal(isStalled([row(100), row(100), row(99)]), false); // too few sessions
  assert.equal(isStalled([row(100), row(99), row(100), row(98)]), true);
  assert.equal(isStalled([row(100), row(99), row(101), row(98)]), false);
});

test('deloadKg is about 10% lighter in 2.5 kg steps', () => {
  assert.equal(deloadKg([S(100, 5), S(100, 5)]), 90);
  assert.equal(deloadKg([S(62.5, 5)]), 57.5);
  assert.equal(deloadKg([]), null);
});

test('progressList summarises each exercise, newest first', () => {
  const E = (id, ...sets) => ({ exercise_id: id, mode: 'wr', sets });
  const ws = [
    W('a', '2025-01-01T10:00:00Z', [E('bench', S(60, 10)), E('squat', S(100, 5))]),
    W('b', '2025-01-08T10:00:00Z', [E('bench', S(62.5, 8))]),
  ];
  const list = progressList(ws);
  assert.deepEqual(list.map((r) => r.exercise_id), ['bench', 'squat']);
  assert.equal(list[0].kg, 62.5);
  assert.equal(list[0].sessions, 2);
  assert.equal(list[0].lastSets[0].kg, 62.5);
  assert.equal(list[1].trend, null);
});
